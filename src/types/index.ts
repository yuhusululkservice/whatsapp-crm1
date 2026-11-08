export interface WhatsAppAccount {
  id: string;
  name: string;
  phoneNumber: string;
  status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'BANNED' | 'SCAN_REQUIRED';
  sessionPath: string; // e.g. ./sessions/session_acc_01
  battery?: number;
  qrCode?: string;
  lastConnectedAt?: string;
  dailySentCount: number;
  dailyLimit: number;
  warmupEnabled: boolean;
  totalDelivered: number;
  profilePic?: string;
  sessionSavedOnDisk?: boolean;
  vaultSaved?: boolean;
}

export interface MessageTemplate {
  id: string;
  title: string;
  content: string; // Supports Spintax {Hi|Hello} and variables {{name}}
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'document' | 'audio';
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  originalFileSize?: number;
  compressed?: boolean;
}

export interface DynamicTimingConfig {
  minDelaySeconds: number; // e.g. 10
  maxDelaySeconds: number; // e.g. 40
  batchSize: number; // e.g. 10 messages
  breakDurationSeconds: number; // e.g. 120 seconds (2 mins)
  typingDelaySeconds?: number; // e.g. 2-5s to simulate typing
}

export interface StopNumber {
  id: string;
  phoneNumber: string;
  normalizedPhone: string;
  reason?: string;
  addedAt: string;
}

export interface Contact {
  id: string;
  phoneNumber: string;
  name: string;
  company?: string;
  customVar1?: string;
  customVar2?: string;
  status?: 'pending' | 'sent' | 'failed' | 'no_whatsapp' | 'stopped' | 'duplicate';
  hasWhatsApp?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  createdAt: string;
  scheduledAt?: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  senderAccountIds: string[]; // multi-account rotation
  rotationStrategy: 'round-robin' | 'random';
  templates: MessageTemplate[]; // template rotation
  contacts: Contact[];
  timings: DynamicTimingConfig;
  skipDuplicates?: boolean;
  autoFilterStopNumbers?: boolean;
  stats: {
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    noWhatsAppCount: number;
    stoppedCount?: number;
    duplicateCount?: number;
    currentSenderIndex: number;
    currentBatchCount: number;
    lastSenderId?: string;
    lastTemplateId?: string;
    timeRemainingEstimate?: string;
  };
}

export interface DeliveryLog {
  id: string;
  campaignId: string;
  campaignName: string;
  timestamp: string;
  recipientPhone: string;
  recipientName: string;
  senderPhone: string;
  senderName: string;
  templateId: string;
  resolvedMessage: string;
  delayAppliedSeconds: number;
  hasWhatsApp: boolean;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'NO_WHATSAPP' | 'STOPPED' | 'SKIPPED_DUPLICATE';
  postAttachment?: string;
  errorMessage?: string;
}

export interface WarmupDialogue {
  id: string;
  timestamp: string;
  fromAccountId: string;
  fromPhone: string;
  toAccountId: string;
  toPhone: string;
  message: string;
  status: 'DELIVERED' | 'READ';
  isAutoStopNotice?: boolean;
}

export type WarmupAutoStopMode = 'OFF' | 'DURATION' | 'DIALOGUE_LIMIT' | 'BOTH';

export interface WarmupConfig {
  autoStopMode: WarmupAutoStopMode;
  stopDurationMinutes: number;
  stopDialogueLimit: number;
  scriptStyle: 'casual' | 'business' | 'sinhala_singlish' | 'office_sync' | 'custom';
  customTopicPrompt: string;
  useAiGeneration: boolean;
  scheduleEnabled: boolean;
  scheduleDays: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  scheduleStartTime: string; // HH:mm in 24h format e.g. "09:00"
  scheduleStopTime: string; // HH:mm in 24h format e.g. "17:00"
  timezone?: string;
}

export interface WarmupStatusData {
  isRunning: boolean;
  logs: WarmupDialogue[];
  config: WarmupConfig;
  startedAt: string | null;
  dialoguesCompletedThisSession: number;
  autoStopTriggered: boolean;
  autoStopReason: string | null;
  nextPairInfo?: {
    senderName: string;
    senderPhone: string;
    receiverName: string;
    receiverPhone: string;
  } | null;
  totalMeshPairs: number;
  isScheduledWindowActive?: boolean;
  currentTimeStr?: string;
}


export interface AutoResponderRule {
  id: string;
  name: string;
  matchType: 'exact' | 'contains' | 'regex';
  keyword: string;
  replyMessage: string;
  isEnabled: boolean;
  typingDelaySeconds: number;
  mediaAttachment?: string;
}
