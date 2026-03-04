import { Resend } from 'resend';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { CATEGORY_RESOURCES } from '../../config/constants';
import type { SessionSummaryEmail } from '../../types';

const PLACEHOLDER_KEYS = ['re_test_fake', 'placeholder', 'your_resend_api_key'];
const isEmailConfigured = !PLACEHOLDER_KEYS.includes(env.EMAIL_API_KEY);
const resend = new Resend(env.EMAIL_API_KEY);

/**
 * Send session summary email to a user.
 * Gracefully skips if Resend is not configured (placeholder API key).
 * HTML template: single file, inline CSS, RTL layout.
 */
export async function sendSessionSummaryEmail(params: SessionSummaryEmail): Promise<boolean> {
  if (!isEmailConfigured) {
    logger.warn('Email service not configured — skipping email send. Set EMAIL_API_KEY in .env');
    return false;
  }

  const { to, userName, sessionDate, personalSummary, sharedCommitments, encouragement, topicCategory, ctaUrl, unsubscribeUrl } = params;

  const resource = CATEGORY_RESOURCES[topicCategory];

  const html = buildEmailHtml({
    userName,
    sessionDate,
    personalSummary,
    sharedCommitments,
    encouragement,
    resourceTitle: resource.title,
    resourceUrl: resource.url,
    ctaUrl,
    unsubscribeUrl: unsubscribeUrl || `${ctaUrl}?start=unsubscribe`,
  });

  try {
    await resend.emails.send({
      from: 'רות בוט זוגיות <noreply@couplebot.app>',
      to: [to],
      subject: `סיכום הסשן שלך — ${sessionDate}`,
      html,
    });

    logger.info('Session summary email sent', { to, sessionDate });
    return true;
  } catch (error) {
    logger.error('Failed to send session summary email', {
      to,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Escape HTML special characters to prevent XSS in email templates */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildEmailHtml(params: {
  userName: string;
  sessionDate: string;
  personalSummary: string;
  sharedCommitments: string;
  encouragement: string;
  resourceTitle: string;
  resourceUrl: string;
  ctaUrl: string;
  unsubscribeUrl: string;
}): string {
  // Escape all user-controlled content to prevent XSS
  const userName = escapeHtml(params.userName);
  const sessionDate = escapeHtml(params.sessionDate);
  const personalSummary = escapeHtml(params.personalSummary);
  const sharedCommitments = escapeHtml(params.sharedCommitments);
  const encouragement = escapeHtml(params.encouragement);
  const resourceTitle = escapeHtml(params.resourceTitle);
  const resourceUrl = encodeURI(params.resourceUrl);
  const ctaUrl = encodeURI(params.ctaUrl);
  const unsubscribeUrl = encodeURI(params.unsubscribeUrl);

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>סיכום סשן — רות בוט זוגיות</title>
</head>
<body style="margin:0; padding:0; background-color:#F5F3F0; font-family:Arial, Helvetica, sans-serif; direction:rtl; text-align:right;">

<!-- Header -->
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1F4E79; padding:24px 0;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0">
  <tr>
    <td style="color:#FFFFFF; font-size:24px; font-weight:bold; padding:0 24px;">
      רות בוט זוגיות 💙
    </td>
    <td style="color:#FFFFFF; font-size:14px; text-align:left; padding:0 24px;">
      ${sessionDate}
    </td>
  </tr>
  </table>
</td></tr>
</table>

<!-- Hero -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:32px 0 16px;">
  <table width="600" cellpadding="0" cellspacing="0">
  <tr><td style="padding:0 24px;">
    <h1 style="color:#1F4E79; font-size:22px; margin:0;">
      עשיתם משהו אמיץ היום ❤️
    </h1>
    <p style="color:#555; font-size:16px; margin-top:8px;">
      היי ${userName}, הנה סיכום הסשן שלך.
    </p>
  </td></tr>
  </table>
</td></tr>
</table>

<!-- Personal Summary -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:8px 0;">
  <table width="600" cellpadding="0" cellspacing="0">
  <tr><td style="padding:0 24px;">
    <div style="background-color:#FFFFFF; border-radius:12px; padding:24px; border-right:4px solid #1F4E79;">
      <h2 style="color:#1F4E79; font-size:18px; margin:0 0 12px;">🪞 המסע האישי שלך</h2>
      <p style="color:#333; font-size:15px; line-height:1.7; margin:0; white-space:pre-wrap;">${personalSummary}</p>
    </div>
  </td></tr>
  </table>
</td></tr>
</table>

<!-- Shared Commitments -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:8px 0;">
  <table width="600" cellpadding="0" cellspacing="0">
  <tr><td style="padding:0 24px;">
    <div style="background-color:#FFFFFF; border-radius:12px; padding:24px; border-right:4px solid #D4A843;">
      <h2 style="color:#1F4E79; font-size:18px; margin:0 0 12px;">🤝 מחויבויות משותפות</h2>
      <p style="color:#333; font-size:15px; line-height:1.7; margin:0; white-space:pre-wrap;">${sharedCommitments}</p>
    </div>
  </td></tr>
  </table>
</td></tr>
</table>

<!-- Encouragement -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:16px 0;">
  <table width="600" cellpadding="0" cellspacing="0">
  <tr><td style="padding:0 24px;">
    <p style="color:#555; font-size:15px; line-height:1.7; font-style:italic; text-align:center;">
      ${encouragement}
    </p>
  </td></tr>
  </table>
</td></tr>
</table>

<!-- CTA Button -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:16px 0;">
  <table width="600" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:0 24px;">
    <a href="${ctaUrl}" style="display:inline-block; background-color:#1F4E79; color:#FFFFFF; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:16px; font-weight:bold;">
      פתח/י סשן נוסף 💬
    </a>
    <p style="color:#888; font-size:13px; margin-top:8px;">כל שיחה היא צעד. אתם כבר עשיתם אחד.</p>
  </td></tr>
  </table>
</td></tr>
</table>

<!-- Reading Resource -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:8px 0;">
  <table width="600" cellpadding="0" cellspacing="0">
  <tr><td style="padding:0 24px;">
    <div style="background-color:#EEF2F7; border-radius:12px; padding:20px;">
      <h3 style="color:#1F4E79; font-size:16px; margin:0 0 8px;">📚 משאב מומלץ</h3>
      <a href="${resourceUrl}" style="color:#1F4E79; font-size:14px; text-decoration:underline;">
        ${resourceTitle}
      </a>
    </div>
  </td></tr>
  </table>
</td></tr>
</table>

<!-- Footer -->
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0">
  <tr><td style="padding:0 24px; text-align:center;">
    <p style="color:#999; font-size:13px; margin:0;">
      רות בוט זוגיות — מרחב בטוח לשיחות שחשובות
    </p>
    <p style="color:#999; font-size:12px; margin-top:8px;">
      <a href="${unsubscribeUrl}" style="color:#999; text-decoration:underline;">הסרה מרשימת התפוצה</a>
    </p>
  </td></tr>
  </table>
</td></tr>
</table>

</body>
</html>`;
}
