import { TopicCategory, RiskLevel, MirrorQuality } from '../config/constants';

// ============================================
// Risk Engine Types
// ============================================

export interface RiskAssessment {
  risk_level: RiskLevel;
  topic_category: TopicCategory;
  action_required: string;
  reasoning: string;
}

// ============================================
// Mirror Evaluation Types (Reflection Gate)
// ============================================

export interface MirrorEvaluation {
  mirror_quality: MirrorQuality;
  captured_need: boolean;
  captured_emotion: boolean;
  missing_element: string | null;
  suggested_reprompt: string | null;
}

// ============================================
// Session Context (passed between layers)
// ============================================

export interface SessionContext {
  sessionId: string;
  anonymizedCoupleId: string;
  userAId: string;
  userBId: string | null;
  currentUserId: string;
  currentRole: 'USER_A' | 'USER_B';
  status: string;
  language: string;
}

// ============================================
// Pipeline Types
// ============================================

export interface PipelineInput {
  context: SessionContext;
  rawText: string;
  messageType: 'TEXT' | 'VOICE';
  telegramMessageId: number;
}

export interface PipelineResult {
  riskLevel: RiskLevel;
  topicCategory: TopicCategory;
  coachingResponse: string;
  reframedMessage: string | null;
  requiresApproval: boolean;
  halted: boolean;
  haltReason?: string;
}

// ============================================
// Reframe Approval Types
// ============================================

export type ReframeAction = 'approve' | 'edit' | 'cancel';

export interface PendingReframe {
  sessionId: string;
  senderRole: 'USER_A' | 'USER_B';
  reframedText: string;
  originalText: string;
  editIterations: number;
  messageId: string;
}

// ============================================
// Claude API Types
// ============================================

export interface CoachingRequest {
  context: SessionContext;
  userMessage: string;
  riskLevel: RiskLevel;
  topicCategory: TopicCategory;
  conversationHistory: ConversationMessage[];
  patternSummaries: string[];
}

export interface ConversationMessage {
  role: 'USER_A' | 'USER_B' | 'BOT';
  content: string;
  timestamp: Date;
}

// ============================================
// Email Types
// ============================================

export interface SessionSummaryEmail {
  to: string;
  userName: string;
  sessionDate: string;
  personalSummary: string;
  sharedCommitments: string;
  encouragement: string;
  topicCategory: TopicCategory;
  ctaUrl: string;
}
