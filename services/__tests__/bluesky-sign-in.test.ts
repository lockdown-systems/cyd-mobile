jest.mock("@/services/bluesky-oauth", () => ({
  authenticateBlueskyAccount: jest.fn(),
}));

jest.mock("@/services/bluesky-account-auth-status", () => ({
  verifyBlueskyAccountAuthStatus: jest.fn(async () => "authenticated"),
}));

const mockRefreshOwnProfile = jest.fn(async () => {});

jest.mock("@/controllers", () => ({
  ACCOUNT_AUTH_STATUS: { authenticated: "authenticated", signedOut: "signedOut" },
  withBlueskyController: jest.fn(
    async (
      _accountId: number,
      _accountUUID: string,
      fn: (controller: unknown) => Promise<unknown>,
    ) => fn({ refreshOwnProfile: mockRefreshOwnProfile }),
  ),
}));

jest.mock("@/services/analytics", () => ({ trackEvent: jest.fn() }));

import { withBlueskyController } from "@/controllers";
import type { AccountListItem } from "@/database/accounts";
import { verifyBlueskyAccountAuthStatus } from "@/services/bluesky-account-auth-status";
import { authenticateBlueskyAccount } from "@/services/bluesky-oauth";
import { connectBlueskyAccount } from "@/services/bluesky-sign-in";

const ACCOUNT = {
  id: 7,
  uuid: "account-uuid",
  handle: "glittertop-cyd.bsky.social",
  did: "did:plc:yn45xekh5kqrat27w6rmafcg",
} as AccountListItem;

describe("signing in to a Bluesky local account", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authenticateBlueskyAccount as jest.Mock).mockResolvedValue(ACCOUNT);
  });

  /**
   * The trap this exists for: whether Cyd can act on an account is cached in
   * that account's own database, and an unforced check returns the cached
   * "signed out" without ever reading the connection. An account restored from
   * a Cyd Bluesky archive has never held either, so authorizing it and
   * stopping there leaves it asking to be authorized again.
   */
  it("refreshes the account's cached auth status, not only its connection", async () => {
    const signIn = await connectBlueskyAccount("glittertop-cyd.bsky.social");

    expect(signIn).toEqual({ account: ACCOUNT, status: "authenticated" });
    expect(withBlueskyController).toHaveBeenCalledWith(
      ACCOUNT.id,
      ACCOUNT.uuid,
      expect.any(Function),
    );
    expect(verifyBlueskyAccountAuthStatus).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      { force: true },
    );
  });

  it("still reports a sign-in when the status could not be refreshed", async () => {
    // The connection is stored by then, so failing to write down what it means
    // is not a failed sign-in.
    (withBlueskyController as jest.Mock).mockRejectedValueOnce(
      new Error("no controller"),
    );

    const signIn = await connectBlueskyAccount("glittertop-cyd.bsky.social");

    // Authorized, but nothing wrote down what that means, so the account is
    // reported as it will actually read until some forced check succeeds.
    expect(signIn).toEqual({ account: ACCOUNT, status: "signedOut" });
  });

  /**
   * The account row learns the fresh handle, display name and avatar, but
   * Browse renders authors out of the account's own database — which, for an
   * account restored from an archive, still holds what the archive carried.
   */
  it("writes down the profile it just fetched, for Browse to show", async () => {
    await connectBlueskyAccount("glittertop-cyd.bsky.social");

    expect(mockRefreshOwnProfile).toHaveBeenCalledTimes(1);
  });

  it("does not try to read a profile it could not authenticate for", async () => {
    (verifyBlueskyAccountAuthStatus as jest.Mock).mockResolvedValueOnce(
      "signedOut",
    );

    await connectBlueskyAccount("glittertop-cyd.bsky.social");

    expect(mockRefreshOwnProfile).not.toHaveBeenCalled();
  });

  it("does not authorize twice", async () => {
    await connectBlueskyAccount("glittertop-cyd.bsky.social");

    expect(authenticateBlueskyAccount).toHaveBeenCalledTimes(1);
    expect(authenticateBlueskyAccount).toHaveBeenCalledWith(
      "glittertop-cyd.bsky.social",
    );
  });
});
