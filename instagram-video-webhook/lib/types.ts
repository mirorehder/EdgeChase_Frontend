// Typen für Instagram-Webhook-Events und gespeicherte Analysen.

export interface IgAttachment {
  type: string; // "video" | "image" | "audio" | "share" | "story_mention" | ...
  payload?: {
    url?: string;
    title?: string;
  };
}

export interface IgMessage {
  mid: string;
  text?: string;
  attachments?: IgAttachment[];
  is_echo?: boolean;
}

export interface IgMessagingEntry {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: IgMessage;
}

export interface IgWebhookEntry {
  id: string;
  time: number;
  messaging?: IgMessagingEntry[];
}

export interface IgWebhookPayload {
  object: string; // erwartet "instagram"
  entry: IgWebhookEntry[];
}

// Job, den der Webhook an /api/process übergibt.
export interface AnalysisJob {
  mid: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  videoUrl: string;
  timestamp: number;
}

export type AnalysisStatus = "processing" | "completed" | "failed";

export interface AnalysisRecord {
  id: string; // = message mid
  status: AnalysisStatus;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  videoUrl: string;
  receivedAt: string; // ISO
  completedAt?: string; // ISO
  frameCount?: number;
  transcript?: string;
  analysis?: string;
  model?: string;
  error?: string;
}
