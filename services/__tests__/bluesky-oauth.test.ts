let mockSessionStore: {
  get(sub: string): Promise<unknown>;
  set(sub: string, value: unknown): Promise<void>;
  del(sub: string): Promise<void>;
};

jest.mock("@atproto/oauth-client", () => ({
  OAuthClient: class MockOAuthClient {
    static fetchMetadata: jest.Mock<Promise<Record<string, never>>, []> =
      jest.fn(async () => ({}));

    constructor(options: { sessionStore: typeof mockSessionStore }) {
      mockSessionStore = options.sessionStore;
    }

    restore = jest.fn(async (did: string) => mockSessionStore.get(did));

    authorize = jest.fn(async () => new URL("https://bsky.social/oauth"));

    callback = jest.fn(async () => {
      await mockSessionStore.set("did:plc:new-account", {
        tokenSet: {
          sub: "did:plc:new-account",
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
        dpopKey: { privateJwk: { kty: "EC", d: "private-key" } },
      });
      return { session: { did: "did:plc:new-account" } };
    });
  },
}));

jest.mock("@atproto/api", () => ({
  Agent: class MockAgent {
    async getProfile() {
      const connection = await mockSessionStore.get("did:plc:new-account");
      if (!connection) {
        throw new Error("OAuth callback connection was not usable");
      }
      return {
        data: {
          did: "did:plc:new-account",
          handle: "alice.bsky.social",
        },
      };
    }
  },
}));

jest.mock("@atproto/jwk-jose", () => ({
  JoseKey: {
    fromJWK: jest.fn(async (jwk: unknown) => ({ privateJwk: jwk })),
    generate: jest.fn(),
  },
}));

jest.mock("@/database", () => ({
  getDatabase: jest.fn(),
}));

jest.mock("@/database/accounts", () => ({
  saveAuthenticatedBlueskyAccount: jest.fn(),
}));

jest.mock("@/services/bluesky-connection-store", () => ({
  deleteBlueskyConnection: jest.fn(),
  getBlueskyConnection: jest.fn(),
  setBlueskyConnection: jest.fn(),
}));

import { getDatabase } from "@/database";
import { saveAuthenticatedBlueskyAccount } from "@/database/accounts";
import {
  deleteBlueskyConnection,
  getBlueskyConnection,
  setBlueskyConnection,
} from "@/services/bluesky-connection-store";
import {
  authenticateBlueskyAccount,
  restoreBlueskyOAuthSession,
  revokeBlueskyAuthorization,
} from "../bluesky-oauth";

describe("Bluesky OAuth protected connection integration", () => {
  it("restores a working session from the local account's UUID-keyed connection", async () => {
    jest.mocked(getDatabase).mockResolvedValue({
      getFirstAsync: jest.fn(async () => ({ uuid: "uuid-alice" })),
    } as never);
    jest.mocked(getBlueskyConnection).mockResolvedValue(
      JSON.stringify({
        tokenSet: {
          sub: "did:plc:alice",
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
        dpopKeyJwk: { kty: "EC", d: "private-key" },
      }),
    );

    const restored = (await restoreBlueskyOAuthSession(
      "did:plc:alice",
      false,
    )) as unknown as { tokenSet: { refresh_token: string } };

    expect(getBlueskyConnection).toHaveBeenCalledWith({
      accountUUID: "uuid-alice",
      legacyDid: "did:plc:alice",
    });
    expect(restored.tokenSet.refresh_token).toBe("refresh-token");
  });

  it("disconnects without deleting the local account or saved data", async () => {
    const db = {
      getFirstAsync: jest.fn(async () => ({
        uuid: "uuid-alice",
        did: "did:plc:alice",
      })),
      runAsync: jest.fn(),
    };
    jest.mocked(getDatabase).mockResolvedValue(db as never);

    await revokeBlueskyAuthorization(25);

    expect(deleteBlueskyConnection).toHaveBeenCalledWith(
      "uuid-alice",
      "did:plc:alice",
    );
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("keeps a new callback connection usable while assigning its local-account UUID", async () => {
    jest.mocked(getDatabase).mockResolvedValue({
      getFirstAsync: jest.fn(async () => null),
    } as never);
    jest.mocked(saveAuthenticatedBlueskyAccount).mockResolvedValue({
      id: 25,
      uuid: "mocked-uuid-0",
      sortOrder: 0,
      type: "bluesky",
      handle: "alice.bsky.social",
      displayName: null,
      avatarUrl: null,
      did: "did:plc:new-account",
    });

    await expect(
      authenticateBlueskyAccount("alice.bsky.social"),
    ).resolves.toMatchObject({ uuid: "mocked-uuid-0" });

    expect(setBlueskyConnection).toHaveBeenCalledWith(
      "mocked-uuid-0",
      expect.stringContaining('"refresh_token":"refresh-token"'),
    );
    expect(saveAuthenticatedBlueskyAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountUUID: "mocked-uuid-0" }),
    );
  });
});
