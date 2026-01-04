import type {
  AutomationConversationPreviewData,
  AutomationMessagePreviewData,
  AutomationPreviewData,
  PostPreviewData,
} from "./types";

export type BlueskyJobType =
  | "verifyAuthorization"
  | "savePosts"
  | "saveLikes"
  | "saveBookmarks"
  | "saveChatConvos"
  | "saveChatMessages";

export type BlueskyJobStatus = "pending" | "running" | "completed" | "failed";

export type BlueskyJobRecord = {
  id: number;
  jobType: BlueskyJobType;
  status: BlueskyJobStatus;
  scheduledAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  progress?: unknown;
  error?: string | null;
};

export type BlueskyJobRunUpdate = {
  jobs: BlueskyJobRecord[];
  activeJobId: number | null;
  speechText?: string;
  progressMessage?: string;
  progressPercent?: number;
  /** When true, the progress for this job cannot be calculated and should show indeterminate animation */
  unknownTotal?: boolean;
  /** @deprecated Use previewData instead */
  previewPost?: PostPreviewData | null;
  /** Unified preview data for posts, conversations, or messages */
  previewData?: AutomationPreviewData | null;
};

export type JobEmit = (update: {
  speechText?: string;
  progressMessage?: string;
  progressPercent?: number;
  /** When true, the progress for this job cannot be calculated and should show indeterminate animation */
  unknownTotal?: boolean;
  /** @deprecated Use previewData instead */
  previewPost?: PostPreviewData | null;
  /** Unified preview data for posts, conversations, or messages */
  previewData?: AutomationPreviewData | null;
}) => void;

export type {
  AutomationConversationPreviewData,
  AutomationMessagePreviewData,
  AutomationPreviewData,
  PostPreviewData,
};

export type SaveJobOptions = {
  posts: boolean;
  likes: boolean;
  bookmarks: boolean;
  chat: boolean;
};
