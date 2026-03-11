/**
 * RC0: Admin script to export a full conversation from the DB.
 *
 * Usage:
 *   npx ts-node src/scripts/exportConversation.ts <sessionId>
 *   npx ts-node src/scripts/exportConversation.ts --latest
 *   npx ts-node src/scripts/exportConversation.ts --all
 *
 * Decrypts all messages and prints them in chronological order.
 */
import { prisma } from '../db/client';
import { decrypt } from '../utils/encryption';

async function exportSession(sessionId: string): Promise<void> {
  const session = await prisma.coupleSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      closedAt: true,
    },
  });

  if (!session) {
    console.error(`Session ${sessionId} not found.`);
    return;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Session: ${session.id}`);
  console.log(`Status: ${session.status}`);
  console.log(`Created: ${session.createdAt.toLocaleString('he-IL')}`);
  if (session.closedAt) {
    console.log(`Closed: ${session.closedAt.toLocaleString('he-IL')}`);
  }
  console.log('='.repeat(60));

  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: {
      senderRole: true,
      messageType: true,
      rawContent: true,
      reframedContent: true,
      approved: true,
      delivered: true,
      riskLevel: true,
      createdAt: true,
    },
  });

  if (messages.length === 0) {
    console.log('(no messages found)');
    return;
  }

  for (const msg of messages) {
    const time = msg.createdAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    const roleLabel = getRoleLabel(msg.senderRole, msg.messageType);
    const riskTag = msg.riskLevel && msg.riskLevel !== 'L1' ? ` [${msg.riskLevel}]` : '';
    const approvedTag = msg.messageType === 'REFRAME' ? (msg.approved ? ' ✅' : ' ⏳') : '';
    const deliveredTag = msg.delivered ? ' 📤' : '';

    let content = '';
    if (msg.rawContent) {
      try {
        content = decrypt(msg.rawContent);
      } catch {
        content = '[decryption failed]';
      }
    }

    // Show reframed content for REFRAME messages
    let reframed = '';
    if (msg.reframedContent) {
      try {
        reframed = decrypt(msg.reframedContent);
      } catch {
        reframed = '[decryption failed]';
      }
    }

    console.log(`\n[${time}] ${roleLabel}${riskTag}${approvedTag}${deliveredTag}`);
    if (content) console.log(`  ${content}`);
    if (reframed && reframed !== content) {
      console.log(`  → Reframe: ${reframed}`);
    }
  }

  console.log(`\n${'='.repeat(60)}\n`);
}

function getRoleLabel(senderRole: string, messageType: string): string {
  if (messageType === 'COACHING') return '🤖 Ruth (coaching)';
  if (messageType === 'SYSTEM') return '🤖 Ruth (system)';
  if (messageType === 'REFRAME') return `📝 ${senderRole === 'USER_A' ? 'User A' : 'User B'} (reframe)`;
  return senderRole === 'USER_A' ? '👤 User A' : '👤 User B';
}

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (!arg) {
    console.error('Usage: npx ts-node src/scripts/exportConversation.ts <sessionId|--latest|--all>');
    process.exit(1);
  }

  if (arg === '--latest') {
    const latest = await prisma.coupleSession.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!latest) {
      console.error('No sessions found.');
      process.exit(1);
    }
    await exportSession(latest.id);
  } else if (arg === '--all') {
    const sessions = await prisma.coupleSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true },
    });
    for (const s of sessions) {
      await exportSession(s.id);
    }
  } else {
    await exportSession(arg);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
