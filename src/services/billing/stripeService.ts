import Stripe from 'stripe';
import { env } from '../../config/env';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';
import { decrypt } from '../../utils/encryption';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

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

  // Idempotency: check if we've already processed this event
  const existingEvent = await prisma.stripeEvent.findUnique({
    where: { stripeEventId: event.id },
  });

  if (existingEvent?.processed) {
    logger.info('Stripe event already processed', { eventId: event.id });
    return;
  }

  // Record the event
  await prisma.stripeEvent.upsert({
    where: { stripeEventId: event.id },
    create: {
      stripeEventId: event.id,
      eventType: event.type,
    },
    update: {},
  });

  // Process event in background
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
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event);
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

async function handlePaymentSucceeded(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = invoice.customer as string;

  logger.info('Payment succeeded', { customerId });

  // Find sessions with this billing owner
  const sessions = await findSessionsByStripeCustomer(customerId);

  for (const session of sessions) {
    if (session.status === 'LOCKED') {
      // Unlock session — payment resolved
      try {
        // Can't transition from LOCKED normally, so update directly
        await prisma.coupleSession.update({
          where: { id: session.id },
          data: { status: 'CLOSED' }, // Return to CLOSED, user can start new session
        });

        logger.info('Session unlocked after payment', { sessionId: session.id });
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

  // TODO: Send friendly notification to billing owner about payment failure
  // [BILLING REVIEW NEEDED] — notification mechanism to user about failed payment
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
        await prisma.coupleSession.update({
          where: { id: session.id },
          data: { status: 'LOCKED' },
        });

        logger.info('Session locked due to subscription cancellation', {
          sessionId: session.id,
        });

        // TODO: Notify both users about locked status with payment link
        // [BILLING REVIEW NEEDED] — notification with payment link
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
  // Find user with this Stripe customer ID (encrypted)
  const allUsers = await prisma.user.findMany({
    where: { stripeCustomerId: { not: null } },
    select: { id: true, stripeCustomerId: true },
  });

  let billingOwnerId: string | null = null;
  for (const user of allUsers) {
    if (user.stripeCustomerId) {
      try {
        if (decrypt(user.stripeCustomerId) === customerId) {
          billingOwnerId = user.id;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!billingOwnerId) {
    logger.warn('No user found for Stripe customer', { customerId });
    return [];
  }

  return prisma.coupleSession.findMany({
    where: { billingOwnerId },
    select: { id: true, status: true },
  });
}

/**
 * Check if a couple needs payment (trial expired, no active subscription).
 */
export async function requiresPayment(sessionId: string): Promise<boolean> {
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
