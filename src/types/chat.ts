export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'sending' | 'sent' | 'error' | 'streaming';

export type VideoGenerationStage = 'submitting' | 'queued' | 'processing' | 'downloading' | 'validating';

export type ImageGenerationStage = 'submitting' | 'generating' | 'receiving' | 'persisting';

export interface VideoGenerationInputs {
  image: string;
  lastFrame: string;
  referenceImages: string[];
}

export interface MessageFile {
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  images?: string[];
  files?: MessageFile[];
  audioUrl?: string;
  duration?: number;
  audioMimeType?: string;
  progressPercent?: number;
  imageFileName?: string;
  imageFileSize?: number;
  imageMimeType?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageProvider?: 'gpt' | 'grok';
  imageGenerationStage?: ImageGenerationStage;
  videoUrl?: string;
  videoMimeType?: string;
  videoFileName?: string;
  videoFileSize?: number;
  videoDuration?: number;
  videoWidth?: number;
  videoHeight?: number;
  videoGenerationStage?: VideoGenerationStage;
  timestamp: number;
  status?: MessageStatus;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  model?: string;
  ownerId?: string;
  ownerType?: 'user' | 'guest';
  pendingTaskId?: string;
}

export interface APIConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
}

export interface StreamChunk {
  delta: { content?: string };
  done: boolean;
}

export interface ModelPreset {
  name: string;
  model: string;
  endpoint: string;
}

export const DEFAULT_API_CONFIG: APIConfig = {
  endpoint: '/api/chat',
  apiKey: '',
  model: 'deepseek-v4',
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1,
};

export const MODEL_PRESETS: ModelPreset[] = [
  { name: 'deepseek-v4', model: 'deepseek-v4', endpoint: '/api/chat' },
];
