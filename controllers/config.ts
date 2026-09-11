export const ACCOUNT_CONFIG_KEYS = {
  authStatus: "authStatus",
  /**
   * What a restored Cyd Bluesky archive said about its own completeness, and
   * where it came from. An account restored from an incomplete archive keeps
   * saying so: the missing assets are still missing, and the rest of the
   * account is still worth having (#96).
   */
  restoredArchiveCompleteness: "restoredArchiveCompleteness",
  restoredArchiveCreatedAt: "restoredArchiveCreatedAt",
  restoredArchiveUuid: "restoredArchiveUuid",
  restoredAt: "restoredAt",
} as const;

export const ACCOUNT_AUTH_STATUS = {
  authenticated: "authenticated",
  signedOut: "signed_out",
} as const;

export type AccountAuthStatusValue =
  (typeof ACCOUNT_AUTH_STATUS)[keyof typeof ACCOUNT_AUTH_STATUS];
