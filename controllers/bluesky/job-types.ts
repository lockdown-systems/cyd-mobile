import type { AccountDeleteSettings } from "@/database/delete-settings";

import type {
  ConversationPreviewData,
  MessagePreviewData,
  PostPreviewData,
  PreviewData,
  ProfileData,
} from "./types";

export type BlueskyJobType =
  | "verifyAuthorization"
  | "savePosts"
  | "saveLikes"
  | "saveBookmarks"
  | "saveChatConvos"
  | "saveChatMessages"
  | "deletePosts"
  | "deleteReposts"
  | "deleteLikes"
  | "deleteBookmarks"
  | "deleteMessages"
  | "unfollowUsers";

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
  previewData?: PreviewData | null;
  /** Optional progress snapshot for the active job */
  progress?: unknown;
};

export type JobEmit = (update: {
  speechText?: string | null;
  progressMessage?: string | null;
  progressPercent?: number;
  /** When true, the progress for this job cannot be calculated and should show indeterminate animation */
  unknownTotal?: boolean;
  /** @deprecated Use previewData instead */
  previewPost?: PostPreviewData | null;
  /** Unified preview data for posts, conversations, or messages */
  previewData?: PreviewData | null;
  /** Optional progress snapshot for the active job */
  progress?: unknown;
}) => void;

export type {
  ConversationPreviewData,
  MessagePreviewData,
  PostPreviewData,
  PreviewData,
  ProfileData,
};

export type SaveJobOptions = {
  posts: boolean;
  likes: boolean;
  bookmarks: boolean;
  chat: boolean;
};

/**
 * Options for defining delete jobs based on user's delete settings.
 * This includes all the settings from AccountDeleteSettings plus the pre-calculated counts.
 */
export type DeleteJobOptions = {
  settings: AccountDeleteSettings;
  /** Pre-calculated counts for each type of data to delete (optional for scheduled jobs) */
  counts?: {
    posts: number;
    reposts: number;
    likes: number;
    bookmarks: number;
    messages: number;
    follows: number;
  };
};

/**
 * Options for defining combined save and delete jobs (used for scheduled automation).
 * This combines save options with delete options to run both in sequence.
 */
export type SaveAndDeleteJobOptions = {
  saveOptions: SaveJobOptions;
  deleteOptions: DeleteJobOptions;
};
