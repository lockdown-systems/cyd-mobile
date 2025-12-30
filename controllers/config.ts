export const ACCOUNT_CONFIG_KEYS = {
  authStatus: "authStatus",
} as const;

export const ACCOUNT_AUTH_STATUS = {
  authenticated: "authenticated",
  signedOut: "signed_out",
} as const;

export type AccountAuthStatusValue =
  (typeof ACCOUNT_AUTH_STATUS)[keyof typeof ACCOUNT_AUTH_STATUS];
