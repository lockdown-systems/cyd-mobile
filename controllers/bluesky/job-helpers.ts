import type {
  BlueskyJobRecord,
  BlueskyJobStatus,
  BlueskyJobType,
} from "./job-types";

export type JobRow = {
  id: number;
  jobType: string;
  status: string;
  scheduledAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  progressJSON: string | null;
  error: string | null;
};

export function mapJobRow(row: JobRow): BlueskyJobRecord {
  return {
    id: row.id,
    jobType: row.jobType as BlueskyJobType,
    status: row.status as BlueskyJobStatus,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    progress: row.progressJSON ? safeParse(row.progressJSON) : undefined,
    error: row.error,
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (err) {
    console.warn("Failed to parse job progress", err);
    return undefined;
  }
}
