import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { WHISPER_MAX_RETRIES } from '../../config/constants';

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

/**
 * Transcribe a voice note using OpenAI Whisper-1.
 * - Downloads audio from Telegram, transcribes, deletes file immediately.
 * - Max 1 retry (audio files are large, cost & latency are high).
 * - On failure: returns null (caller should ask user to type instead).
 */
export async function transcribeVoiceNote(params: {
  filePath: string;
  sessionId: string;
}): Promise<string | null> {
  const { filePath, sessionId } = params;

  for (let attempt = 0; attempt <= WHISPER_MAX_RETRIES; attempt++) {
    try {
      const fileStream = fs.createReadStream(filePath);

      const transcription = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: fileStream,
      });

      logger.info('Voice transcription successful', {
        sessionId,
        textLength: transcription.text.length,
      });

      return transcription.text;
    } catch (error) {
      logger.error('Whisper transcription failed', {
        sessionId,
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt === WHISPER_MAX_RETRIES) {
        return null;
      }
    }
  }

  return null;
}

/**
 * Download a voice note from Telegram to a temporary file.
 * Returns the local file path.
 */
export async function downloadVoiceFile(params: {
  fileUrl: string;
  sessionId: string;
}): Promise<string> {
  const { fileUrl, sessionId } = params;

  const tmpDir = path.join(process.cwd(), '.tmp', 'voice');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const fileName = `voice_${sessionId}_${Date.now()}.ogg`;
  const filePath = path.join(tmpDir, fileName);

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download voice file: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  logger.info('Voice file downloaded', {
    sessionId,
    filePath,
    sizeBytes: buffer.length,
  });

  return filePath;
}

/**
 * Delete a voice file from disk.
 * CRITICAL: Audio files must be deleted immediately after transcription.
 */
export function deleteVoiceFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('Voice file deleted', { filePath });
    }
  } catch (error) {
    logger.error('Failed to delete voice file', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
