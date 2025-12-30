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
  progressText?: string;
  progressPercent?: number;
  detailText?: string;
};

export type JobEmit = (update: {
  speechText?: string;
  progressText?: string;
  progressPercent?: number;
  detailText?: string;
}) => void;

export type SaveJobOptions = {
  posts: boolean;
  likes: boolean;
  bookmarks: boolean;
  chat: boolean;
  following: boolean;
};
