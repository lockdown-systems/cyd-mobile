const mockLegacyValues = new Map<string, string>();
const mockProtectedValues = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockLegacyValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockLegacyValues.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockLegacyValues.delete(key);
    }),
  },
}));

jest.mock(
  "expo-secure-store",
  () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    getItemAsync: jest.fn(
      async (key: string) => mockProtectedValues.get(key) ?? null,
    ),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      mockProtectedValues.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      mockProtectedValues.delete(key);
    }),
  }),
  { virtual: true },
);

jest.mock("@atproto/oauth-client", () => ({ OAuthClient: class {} }));
jest.mock("@atproto/api", () => ({ Agent: class {} }));
jest.mock("@atproto/jwk-jose", () => ({ JoseKey: {} }));

jest.mock("@/database", () => ({
  getDatabase: jest.fn(async () => ({
    getFirstAsync: jest.fn(async () => ({
      uuid: "uuid-alice",
      did: "did:plc:alice",
    })),
  })),
}));

jest.mock("@/database/accounts", () => ({
  saveAuthenticatedBlueskyAccount: jest.fn(),
}));

jest.mock("@/controllers/BlueskyAccountController", () => ({
  BlueskyAccountController: jest
    .fn()
    .mockImplementation(() => new MockBlueskyAccountController()),
}));

import {
  ACCOUNT_AUTH_STATUS,
  disposeAllBlueskyControllersForTests,
  withBlueskyController,
  type AccountAuthStatusValue,
} from "@/controllers";
import type { AccountListItem } from "@/database/accounts";
import { verifyBlueskyAccountAuthStatus } from "@/services/bluesky-account-auth-status";
import {
  deleteBlueskyConnection,
  getBlueskyConnection,
  setBlueskyConnection,
} from "@/services/bluesky-connection-store";
import { disconnectBlueskyAccount } from "@/services/bluesky-disconnect";

const ACCOUNT_UUID = "uuid-alice";
const ACCOUNT_DID = "did:plc:alice";

const account: AccountListItem = {
  id: 7,
  uuid: ACCOUNT_UUID,
  sortOrder: 0,
  type: "bluesky",
  handle: "alice.bsky.social",
  displayName: "Alice",
  avatarUrl: null,
  did: ACCOUNT_DID,
};

/**
 * Stands in for the real controller, modelling the one property that caused
 * the bug: the agent is bound to whichever Bluesky connection was stored when
 * initAgent() ran, and keeps using it until something rebuilds it.
 */
class MockBlueskyAccountController {
  private agentConnection: string | null = null;
  private config = new Map<string, string>();

  async initDB(): Promise<void> {}

  async cleanup(): Promise<void> {
    this.agentConnection = null;
  }

  async initAgent(): Promise<void> {
    const connection = await getBlueskyConnection({
      accountUUID: ACCOUNT_UUID,
      legacyDid: ACCOUNT_DID,
    });
    if (!connection) {
      const missing = new Error("Missing Bluesky session (signed out)");
      missing.name = "MissingBlueskySessionError";
      throw missing;
    }
    this.agentConnection = connection;
  }

  isAgentReady(): boolean {
    return this.agentConnection !== null;
  }

  resetAgent(): void {
    this.agentConnection = null;
  }

  async getProfile(): Promise<{ did: string; handle: string }> {
    const stored = await getBlueskyConnection({
      accountUUID: ACCOUNT_UUID,
      legacyDid: ACCOUNT_DID,
    });
    if (stored !== this.agentConnection) {
      // What @atproto/oauth-client does when a session it holds turns out to
      // be unusable: it deletes the store entry for that DID. The entry is
      // keyed by account, so it takes any newer connection down with it.
      await deleteBlueskyConnection(ACCOUNT_UUID, ACCOUNT_DID);
      throw new Error("Session expired and no callback provided");
    }
    return { did: ACCOUNT_DID, handle: account.handle };
  }

  async getConfig(key: string): Promise<string | null> {
    return this.config.get(key) ?? null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    this.config.set(key, value);
  }
}

/** The store side of completing an OAuth authorization. */
async function completeAuthorization(connection: string): Promise<void> {
  await setBlueskyConnection(ACCOUNT_UUID, connection);
}

function verifyAfterAuthorization(): Promise<AccountAuthStatusValue> {
  return withBlueskyController(account.id, account.uuid, (controller) =>
    verifyBlueskyAccountAuthStatus(controller, account, { force: true }),
  );
}

describe("reauthenticating on a warm controller", () => {
  beforeEach(async () => {
    await disposeAllBlueskyControllersForTests();
    mockLegacyValues.clear();
    mockProtectedValues.clear();
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await disposeAllBlueskyControllersForTests();
    jest.restoreAllMocks();
  });

  it("keeps the new connection and reports authenticated", async () => {
    await completeAuthorization("connection-1");
    expect(await verifyAfterAuthorization()).toBe(
      ACCOUNT_AUTH_STATUS.authenticated,
    );

    expect(await disconnectBlueskyAccount(account)).toBe(
      ACCOUNT_AUTH_STATUS.signedOut,
    );

    await completeAuthorization("connection-2");

    expect(await verifyAfterAuthorization()).toBe(
      ACCOUNT_AUTH_STATUS.authenticated,
    );
    expect(await getBlueskyConnection({ accountUUID: ACCOUNT_UUID })).toBe(
      "connection-2",
    );
  });

  it("drops the revoked agent as part of disconnecting", async () => {
    await completeAuthorization("connection-1");
    const controller = await withBlueskyController(
      account.id,
      account.uuid,
      async (instance) => instance,
    );
    await verifyAfterAuthorization();
    expect(controller.isAgentReady()).toBe(true);

    await disconnectBlueskyAccount(account);

    expect(controller.isAgentReady()).toBe(false);
  });

  it("keeps the new connection when the session was revoked outside Cyd", async () => {
    // No disconnect here: Bluesky invalidated the session, so nothing in Cyd
    // knows the cached agent has gone stale until it is used.
    await completeAuthorization("connection-1");
    await verifyAfterAuthorization();

    await completeAuthorization("connection-2");

    expect(await verifyAfterAuthorization()).toBe(
      ACCOUNT_AUTH_STATUS.authenticated,
    );
    expect(await getBlueskyConnection({ accountUUID: ACCOUNT_UUID })).toBe(
      "connection-2",
    );
  });
});
