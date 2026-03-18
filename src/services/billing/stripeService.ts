import Stripe from 'stripe';
import { Telegraf } from 'telegraf';
import { env } from '../../config/env';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';
import { hmacHash, decrypt, encrypt } from '../../utils/encryption';
import { SessionStateMachine } from '../../core/stateMachine/sessionStateMachine';

const PLACEHOLDER_KEYS = ['sk_test_fake', 'placeholder', 'your_stripe_secret_key'];

function isStripeConfigured(): boolean {
  return !PLACEHOLDER_KEYS.includes(env.STRIPE_SECRET_KEY);
}

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// Bot instance for sending notifications — set via setBotInstance()
let botInstance: Telegraf | null = null;

/**
 * Set the bot instance for sending billing notifications.
 * Called once during app startup.
 */
export function setBillingBotInstance(bot: Telegraf): void {
  botInstance = bot;
}

/**
 * Verify and process Stripe webhook events.
 * - Idempotency: Check event ID before processing.
 * - Always return HTTP 200 to Stripe.
 * - Process in background to avoid timeout.
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string
): Promise<void> {
  if (!isStripeConfigured()) {
    logger.warn('Stripe not configured — ignoring webhook');
    return;
  }

  let event: Stripe.Event;

  // Verify webhook signature
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    logger.error('Stripe webhook signature verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Webhook signature verification failed');
  }

  // Idempotency: atomic claim via upsert + CAS check.
  // The upsert creates the record if new, or returns existing.
  // Only process if the record was just created (not yet processed).
  const existingEvent = await prisma.stripeEvent.findUnique({
    where: { stripeEventId: event.id },
  });

  if (existingEvent?.processed) {
    logger.info('Stripe event already processed', { eventId: event.id });
    return;
  }

  if (existingEvent) {
    // Record exists but not processed — another handler is already working on it
    logger.info('Stripe event already claimed by another handler', { eventId: event.id });
    return;
  }

  // Atomic create — if two concurrent requests race, one will fail with unique constraint
  try {
    await prisma.stripeEvent.create({
      data: {
        stripeEventId: event.id,
        eventType: event.type,
      },
    });
  } catch (createError) {
    // Unique constraint violation = another handler already claimed this event
    logger.info('Stripe event already claimed (concurrent)', { eventId: event.id });
    return;
  }

  // Process event in background — only the handler that successfully created the record proceeds
  processEventInBackground(event).catch((error) => {
    logger.error('Stripe event processing failed', {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function processEventInBackground(event: Stripe.Event): Promise<void> {
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event);
        break;
      case 'invoice.payment_action_required':
        await handlePaymentActionRequired(event);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event);
        break;
      default:
        logger.info('Unhandled Stripe event type', { eventType: event.type });
    }

    // Mark as processed
    await prisma.stripeEvent.update({
      where: { stripeEventId: event.id },
      data: { processed: true, processedAt: new Date() },
    });
  } catch (error) {
    logger.error('Failed to process Stripe event', {
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const customerId = session.customer as string;
  const userId = session.metadata?.userId;

  logger.info('Checkout session completed', { customerId, userId });

  // Link Stripe customer to user if not already linked
  if (userId && customerId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          stripeCustomerId: encrypt(customerId),
          stripeCustomerIdHash: hmacHash(customerId),
        },
      });
    }

    // Set billing owner on the session
    const sessionId = session.metadata?.sessionId;
    if (sessionId) {
      await prisma.coupleSession.update({
        where: { id: sessionId },
        data: { billingOwnerId: userId, isTrial: false },
      });
    }
  }

  // Notify user of successful payment
  await notifyBillingOwner(customerId,
    '✅ התשלום התקבל בהצלחה! אפשר להתחיל סשן חדש עם /start'
  );
}

async function handlePaymentActionRequired(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = invoice.customer as string;
  const hostedUrl = invoice.hosted_invoice_url;

  logger.warn('Payment action required (3D Secure)', { customerId });

  const message = hostedUrl
    ? `⚠️ התשלום שלך דורש אימות נוסף (3D Secure).\n\nלחץ/י על הקישור כדי להשלים את האימות:`
    : '⚠️ התשלום שלך דורש אימות נוסף. בדוק/י את המייל שלך להוראות מהבנק.';

  if (botInstance && hostedUrl) {
    try {
      const hash = hmacHash(customerId);
      const user = await prisma.user.findUnique({
        where: { stripeCustomerIdHash: hash },
        select: { telegramId: true },
      });

      if (user) {
        const telegramId = decrypt(user.telegramId);
        const { Markup } = await import('telegraf');
        await botInstance.telegram.sendMessage(telegramId, message,
          Markup.inlineKeyboard([
            [Markup.button.url('🔐 השלם אימות', hostedUrl)],
          ])
        );
      }
    } catch (error) {
      logger.error('Failed to send payment action required notification', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    await notifyBillingOwner(customerId, message);
  }
}

async function handlePaymentSucceeded(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = invoice.customer as string;

  logger.info('Payment succeeded', { customerId });

  // Find sessions with this billing owner
  const sessions = await findSessionsByStripeCustomer(customerId);

  for (const session of sessions) {
    if (session.status === 'LOCKED') {
      try {
        // LOCKED is terminal in the state machine, so direct update is necessary
        // but we still log properly
        await prisma.coupleSession.update({
          where: { id: session.id },
          data: { status: 'CLOSED' },
        });

        logger.info('Session state transition (payment unlock)', {
          sessionId: session.id,
          from: 'LOCKED',
          to: 'CLOSED',
          metadata: { reason: 'payment_succeeded' },
        });
      } catch (error) {
        logger.error('Failed to unlock session', {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

async function handlePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = invoice.customer as string;

  logger.warn('Payment failed', { customerId });

  // Find active sessions for this customer
  const sessions = await findSessionsByStripeCustomer(customerId);

  for (const session of sessions) {
    // Don't close active sessions on payment failure
    // Only prevent new sessions from starting
    // "סשן פעיל לא נסגר אוטומטית כשהכרטיס נדחה"
    logger.info('Payment failed for active session — NOT closing', {
      sessionId: session.id,
      status: session.status,
    });
  }

  // Notify billing owner about payment failure
  await notifyBillingOwner(customerId,
    '⚠️ התשלום נכשל. הסשנים הפעילים שלך ממשיכים לעבוד, אבל לא ניתן יהיה לפתוח סשנים חדשים עד שהתשלום יעודכן.\n\n💳 עדכן/י את אמצעי התשלום כדי להמשיך ליהנות מרות בוט זוגיות.'
  );
}

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = subscription.customer as string;

  logger.info('Subscription deleted', { customerId });

  // Move all active sessions to LOCKED (read-only)
  const sessions = await findSessionsByStripeCustomer(customerId);

  for (const session of sessions) {
    if (['ACTIVE', 'PAUSED', 'ASYNC_COACHING'].includes(session.status)) {
      try {
        await SessionStateMachine.transition(session.id, 'LOCKED', {
          reason: 'subscription_deleted',
        });

        logger.info('Session locked due to subscription cancellation', {
          sessionId: session.id,
        });

        // Notify both users about locked status
        await notifySessionUsers(session.id,
          '🔒 הסשן הועבר למצב קריאה בלבד בעקבות ביטול המנוי.\n\nכדי לחדש את הגישה, חדשו את המנוי.\nהנתונים שלכם נשמרים בבטחה.'
        );
      } catch (error) {
        logger.error('Failed to lock session', {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

async function findSessionsByStripeCustomer(customerId: string): Promise<
  Array<{ id: string; status: string }>
> {
  // O(1) lookup using HMAC hash
  const hash = hmacHash(customerId);
  const user = await prisma.user.findUnique({
    where: { stripeCustomerIdHash: hash },
    select: { id: true },
  });

  if (!user) {
    logger.warn('No user found for Stripe customer', { customerId });
    return [];
  }

  const billingOwnerId = user.id;

  return prisma.coupleSession.findMany({
    where: { billingOwnerId },
    select: { id: true, status: true },
  });
}

/**
 * Notify the billing owner (by Stripe customer ID) via Telegram.
 */
async function notifyBillingOwner(stripeCustomerId: string, message: string): Promise<void> {
  if (!botInstance) {
    logger.warn('Cannot send billing notification — bot instance not set');
    return;
  }

  try {
    const hash = hmacHash(stripeCustomerId);
    const user = await prisma.user.findUnique({
      where: { stripeCustomerIdHash: hash },
      select: { telegramId: true },
    });

    if (!user) return;

    const telegramId = decrypt(user.telegramId);
    await botInstance.telegram.sendMessage(telegramId, message);
  } catch (error) {
    logger.error('Failed to send billing notification', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Notify both users in a session via Telegram.
 */
async function notifySessionUsers(sessionId: string, message: string): Promise<void> {
  if (!botInstance) {
    logger.warn('Cannot send session notification — bot instance not set');
    return;
  }

  try {
    const session = await prisma.coupleSession.findUnique({
      where: { id: sessionId },
      include: { userA: { select: { telegramId: true } }, userB: { select: { telegramId: true } } },
    });

    if (!session) return;

    const userIds = [session.userA.telegramId];
    if (session.userB) userIds.push(session.userB.telegramId);

    for (const encryptedTelegramId of userIds) {
      try {
        const telegramId = decrypt(encryptedTelegramId);
        await botInstance.telegram.sendMessage(telegramId, message);
      } catch (sendError) {
        logger.error('Failed to send notification to user', {
          sessionId,
          error: sendError instanceof Error ? sendError.message : String(sendError),
        });
      }
    }
  } catch (error) {
    logger.error('Failed to notify session users', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Create a Stripe Checkout Session for a user.
 * Returns the checkout URL for redirection.
 * Returns null gracefully when Stripe is not configured.
 */
export async function createCheckoutSession(params: {
  sessionId: string;
  userId: string;
  botUsername: string;
}): Promise<string | null> {
  if (!isStripeConfigured()) {
    logger.warn('Stripe not configured — payment bypassed. Set STRIPE_SECRET_KEY in .env');
    return null;
  }

  const { sessionId, userId, botUsername } = params;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true, email: true },
    });

    let customerId: string | undefined;

    // Reuse existing Stripe customer if available
    if (user?.stripeCustomerId) {
      customerId = decrypt(user.stripeCustomerId);
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `https://t.me/${botUsername}?start=payment_success`,
      cancel_url: `https://t.me/${botUsername}?start=payment_cancel`,
      metadata: {
        sessionId,
        userId,
      },
    };

    if (customerId) {
      sessionParams.customer = customerId;
    }

    const checkoutSession = await stripe.checkout.sessions.create(sessionParams);

    // Store customer ID if new
    if (checkoutSession.customer && !user?.stripeCustomerId) {
      const stripeCustomerId = checkoutSession.customer as string;
      await prisma.user.update({
        where: { id: userId },
        data: {
          stripeCustomerId: encrypt(stripeCustomerId),
          stripeCustomerIdHash: hmacHash(stripeCustomerId),
        },
      });
    }

    logger.info('Stripe Checkout Session created', {
      sessionId,
      checkoutSessionId: checkoutSession.id,
    });

    return checkoutSession.url;
  } catch (error) {
    logger.error('Failed to create Stripe Checkout Session', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Check if a couple needs payment (trial expired, no active subscription).
 * Always returns false (free) when Stripe is not configured.
 */
export async function requiresPayment(sessionId: string): Promise<boolean> {
  if (!isStripeConfigured()) return false;
  const session = await prisma.coupleSession.findUnique({
    where: { id: sessionId },
    select: { isTrial: true, billingOwnerId: true },
  });

  if (!session) return true;

  // Trial sessions are free
  if (session.isTrial) return false;

  // Check if billing owner has active subscription
  if (!session.billingOwnerId) return true;

  const billingOwner = await prisma.user.findUnique({
    where: { id: session.billingOwnerId },
    select: { stripeCustomerId: true },
  });

  if (!billingOwner?.stripeCustomerId) return true;

  try {
    const customerId = decrypt(billingOwner.stripeCustomerId);
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    return subscriptions.data.length === 0;
  } catch {
    return true;
  }
}
