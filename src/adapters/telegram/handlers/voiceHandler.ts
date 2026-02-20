import { Context } from 'telegraf';
import { SessionManager } from '../../../core/stateMachine/sessionManager';
import { processMessage } from '../../../core/pipeline/messagePipeline';
import { transcribeVoiceNote, downloadVoiceFile, deleteVoiceFile } from '../../../services/voice/whisperService';
import { logger } from '../../../utils/logger';
import { detectLanguage, splitMessage } from '../../../utils/telegramHelpers';
import { encrypt } from '../../../utils/encryption';
import { TELEGRAM_MAX_VOICE_SIZE_MB } from '../../../config/constants';
import { pendingReframes } from './callbackHandler';
import { Markup } from 'telegraf';
import { prisma } from '../../../db/client';
import type { PendingReframe } from '../../../types';

/**
 * Handle voice messages.
 * Download → Transcribe (Whisper) → Delete audio → Process as text.
 */
export async function handleVoice(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.message || !('voice' in ctx.message)) return;

  const telegramId = ctx.from.id.toString();
  const voice = ctx.message.voice;

  // Check file size (max 20MB)
  if (voice.file_size && voice.file_size > TELEGRAM_MAX_VOICE_SIZE_MB * 1024 * 1024) {
    await ctx.reply('ההודעה הקולית גדולה מדי. נסה/י להקליט הודעה קצרה יותר.');
    return;
  }

  const userId = await SessionManager.findOrCreateUser(telegramId, ctx.from.first_name);
  const session = await SessionManager.getActiveSession(userId);

  if (!session) {
    await ctx.reply('אין סשן פתוח. הקלד/י /start להתחיל.');
    return;
  }

  await ctx.reply('🎙️ מתמלל את ההודעה הקולית...');

  let filePath: string | null = null;

  try {
    // Download voice file — use Telegraf's built-in URL builder
    const fileLink = await ctx.telegram.getFileLink(voice.file_id);
    const fileUrl = fileLink.toString();

    filePath = await downloadVoiceFile({
      fileUrl,
      sessionId: session.id,
    });

    // Transcribe
    const transcript = await transcribeVoiceNote({
      filePath,
      sessionId: session.id,
    });

    // CRITICAL: Delete audio file immediately after transcription
    deleteVoiceFile(filePath);
    filePath = null;

    if (!transcript) {
      // Whisper failed — ask user to type
      await ctx.reply('לא הצלחתי לתמלל את ההודעה הקולית. נסה/י לכתוב את ההודעה בטקסט.');
      return;
    }

    await ctx.reply(`📝 תמלול: "${transcript}"`);

    // Process transcribed text through the pipeline
    const language = detectLanguage(transcript);

    const result = await processMessage({
      context: {
        sessionId: session.id,
        anonymizedCoupleId: session.anonymizedCoupleId,
        userAId: session.role === 'USER_A' ? userId : '',
        userBId: session.role === 'USER_B' ? userId : null,
        currentUserId: userId,
        currentRole: session.role,
        status: session.status,
        language,
      },
      rawText: transcript,
      messageType: 'VOICE',
      telegramMessageId: ctx.message.message_id,
    });

    // Send coaching response
    for (const chunk of splitMessage(result.coachingResponse)) {
      await ctx.reply(chunk);
    }

    // Show reframe approval if applicable
    if (result.requiresApproval && result.reframedMessage) {
      const message = await prisma.message.create({
        data: {
          sessionId: session.id,
          senderRole: session.role,
          messageType: 'REFRAME',
          reframedContent: encrypt(result.reframedMessage),
          rawContent: encrypt(transcript),
          riskLevel: result.riskLevel,
          topicCategory: result.topicCategory,
        },
      });

      const pending: PendingReframe = {
        sessionId: session.id,
        senderRole: session.role,
        reframedText: result.reframedMessage,
        originalText: transcript,
        editIterations: 0,
        messageId: message.id,
      };

      pendingReframes.set(message.id, pending);

      await ctx.reply(
        `📝 הנה ניסוח מוצע לשליחה לבן/בת הזוג:\n\n${result.reframedMessage}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ שלח כפי שזה', `reframe_approve:${message.id}`)],
          [Markup.button.callback('✏️ אני רוצה לערוך', `reframe_edit:${message.id}`)],
          [Markup.button.callback('❌ בטל / אל תשלח', `reframe_cancel:${message.id}`)],
        ])
      );
    }
  } catch (error) {
    logger.error('Voice handling error', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply('אירעה שגיאה בעיבוד ההודעה הקולית. נסה/י לכתוב בטקסט.');
  } finally {
    // Safety net: ensure audio file is deleted
    if (filePath) {
      deleteVoiceFile(filePath);
    }
  }
}
