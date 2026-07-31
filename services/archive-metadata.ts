export const SUPPORTED_BLUESKY_ARCHIVE_VERSION = 2;

export type BlueskyArchiveMetadata = {
  format: "cyd-archive";
  platform: "bluesky";
  version: 2;
  createdAt: string;
  accountDid: string;
  accountUuid: string;
  completeness: "complete" | "incomplete";
};

export type BlueskyArchiveMetadataResult =
  | { supported: true; metadata: BlueskyArchiveMetadata }
  | {
      supported: false;
      reason: "legacy" | "newer-version" | "platform" | "invalid";
      error: string;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_MILLISECONDS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalid(detail: string): BlueskyArchiveMetadataResult {
  return {
    supported: false,
    reason: "invalid",
    error: `Invalid or corrupt Bluesky archive: ${detail}`,
  };
}

function isPrototypeMetadata(value: Record<string, unknown>): boolean {
  return (
    value.type === "bluesky" ||
    ("uuid" in value && "exportTimestamp" in value && "account" in value)
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !RFC3339_MILLISECONDS_PATTERN.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

export function classifyBlueskyArchiveMetadata(
  value: unknown,
): BlueskyArchiveMetadataResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("metadata.json must contain an object.");
  }

  const metadata = value as Record<string, unknown>;

  if (isPrototypeMetadata(metadata)) {
    return {
      supported: false,
      reason: "legacy",
      error: "Unsupported legacy Bluesky archive format.",
    };
  }

  if (metadata.format !== "cyd-archive") {
    return invalid("the format discriminator is missing or invalid.");
  }

  if (metadata.platform !== "bluesky") {
    if (typeof metadata.platform === "string" && metadata.platform.length > 0) {
      return {
        supported: false,
        reason: "platform",
        error: `Unsupported archive platform: ${metadata.platform}.`,
      };
    }
    return invalid("the platform discriminator is missing or invalid.");
  }

  if (!Number.isInteger(metadata.version)) {
    return invalid("the Bluesky archive version is missing or invalid.");
  }

  const version = metadata.version as number;
  if (version > SUPPORTED_BLUESKY_ARCHIVE_VERSION) {
    return {
      supported: false,
      reason: "newer-version",
      error: `Unsupported newer Bluesky archive version ${version}.`,
    };
  }
  if (version < SUPPORTED_BLUESKY_ARCHIVE_VERSION) {
    return {
      supported: false,
      reason: "legacy",
      error: "Unsupported legacy Bluesky archive format.",
    };
  }

  if (!isCanonicalTimestamp(metadata.createdAt)) {
    return invalid(
      "createdAt must be an RFC 3339 UTC timestamp with milliseconds.",
    );
  }
  if (
    typeof metadata.accountDid !== "string" ||
    !metadata.accountDid.startsWith("did:") ||
    metadata.accountDid.split(":").length < 3
  ) {
    return invalid("accountDid must be a DID.");
  }
  if (
    typeof metadata.accountUuid !== "string" ||
    !UUID_PATTERN.test(metadata.accountUuid)
  ) {
    return invalid("accountUuid must be a UUID.");
  }
  if (
    metadata.completeness !== "complete" &&
    metadata.completeness !== "incomplete"
  ) {
    return invalid("completeness must be complete or incomplete.");
  }

  return {
    supported: true,
    metadata: {
      format: "cyd-archive",
      platform: "bluesky",
      version: SUPPORTED_BLUESKY_ARCHIVE_VERSION,
      createdAt: metadata.createdAt,
      accountDid: metadata.accountDid,
      accountUuid: metadata.accountUuid,
      completeness: metadata.completeness,
    },
  };
}
