import type { AutomationPostPreviewData } from "./types";

export type BlueskyJobType =
  | "verifyAuthorization"
  | "savePosts"
  | "saveLikes"
  | "saveBookmarks"
  | "saveChats"
  | "saveFollowing";

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
  previewPost?: AutomationPostPreviewData | null;
};

export type JobEmit = (update: {
  speechText?: string;
  progressMessage?: string;
  progressPercent?: number;
  /** When true, the progress for this job cannot be calculated and should show indeterminate animation */
  unknownTotal?: boolean;
  previewPost?: AutomationPostPreviewData | null;
}) => void;

export type SaveJobOptions = {
  posts: boolean;
  likes: boolean;
  bookmarks: boolean;
  chat: boolean;
  following: boolean;
};
