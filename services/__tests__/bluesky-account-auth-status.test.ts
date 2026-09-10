jest.mock("@/services/bluesky-connection-store", () => ({
  getBlueskyConnection: jest.fn(async () => "stored-connection"),
}));

import type { AppBskyActorDefs } from "@atproto/api";

import type { BlueskyAccountController } from "@/controllers/BlueskyAccountController";
import {
  ACCOUNT_AUTH_STATUS,
  ACCOUNT_CONFIG_KEYS,
  type AccountAuthStatusValue,
} from "@/controllers/config";
import type { AccountListItem } from "@/database/accounts";
import { getBlueskyConnection } from "@/services/bluesky-connection-store";

import { verifyBlueskyAccountAuthStatus } from "../bluesky-account-auth-status";

const ACCOUNT_DID = "did:plc:someone";

const account: AccountListItem = {
  id: 1,
  uuid: "uuid-1",
  sortOrder: 0,
  type: "bluesky",
  handle: "someone.bsky.social",
  displayName: "Someone",
  avatarUrl: null,
  did: ACCOUNT_DID,
};

type Profile = AppBskyActorDefs.ProfileViewDetailed;

type FakeController = {
  getConfig: jest.Mock<Promise<string | null>, [string]>;
  setConfig: jest.Mock<Promise<void>, [string, string]>;
  isAgentReady: jest.Mock<boolean, []>;
  initAgent: jest.Mock<Promise<void>, []>;
  getProfile: jest.Mock<Promise<Profile | null>, []>;
};

function matchingProfile(): Profile {
  return { did: ACCOUNT_DID, handle: account.handle } as Profile;
}

function createController(
  overrides: Partial<FakeController> = {},
): FakeController {
  return {
    getConfig: jest.fn(
      async (_key: string): Promise<string | null> =>
        ACCOUNT_AUTH_STATUS.authenticated,
    ),
    setConfig: jest.fn(async (_key: string, _value: string) => undefined),
    isAgentReady: jest.fn(() => true),
    initAgent: jest.fn(async () => undefined),
    getProfile: jest.fn(async () => matchingProfile()),
    ...overrides,
  };
}

function verify(
  controller: FakeController,
  options?: { force?: boolean },
): Promise<AccountAuthStatusValue> {
  return verifyBlueskyAccountAuthStatus(
    controller as unknown as BlueskyAccountController,
    account,
    options,
  );
}

describe("verifyBlueskyAccountAuthStatus", () => {
  beforeEach(() => {
    jest.mocked(getBlueskyConnection).mockResolvedValue("stored-connection");
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the stored signed-out status without contacting Bluesky", async () => {
    const controller = createController({
      getConfig: jest.fn(
        async (_key: string): Promise<string | null> =>
          ACCOUNT_AUTH_STATUS.signedOut,
      ),
    });

    const status = await verify(controller);

    expect(status).toBe(ACCOUNT_AUTH_STATUS.signedOut);
    expect(controller.initAgent).not.toHaveBeenCalled();
    expect(controller.getProfile).not.toHaveBeenCalled();
  });

  it("reuses a ready agent when the check is not forced", async () => {
    const controller = createController();

    const status = await verify(controller);

    expect(status).toBe(ACCOUNT_AUTH_STATUS.authenticated);
    expect(controller.initAgent).not.toHaveBeenCalled();
    expect(controller.getProfile).toHaveBeenCalledTimes(1);
  });

  it("initializes the agent when none is ready", async () => {
    const controller = createController({
      isAgentReady: jest.fn(() => false),
    });

    await verify(controller);

    expect(controller.initAgent).toHaveBeenCalledTimes(1);
  });

  // Regression: a controller cached across a disconnect still reports its
  // agent as ready, but that agent holds the pre-disconnect session. Reusing
  // it makes the freshly stored connection look expired, and the failed
  // refresh deletes it.
  it("rebuilds a ready agent when the check is forced", async () => {
    const controller = createController();

    const status = await verify(controller, { force: true });

    expect(controller.initAgent).toHaveBeenCalledTimes(1);
    expect(controller.initAgent.mock.invocationCallOrder[0]).toBeLessThan(
      controller.getProfile.mock.invocationCallOrder[0],
    );
    expect(status).toBe(ACCOUNT_AUTH_STATUS.authenticated);
  });

  it("forces a check even when the stored status is signed out", async () => {
    const controller = createController({
      getConfig: jest.fn(
        async (_key: string): Promise<string | null> =>
          ACCOUNT_AUTH_STATUS.signedOut,
      ),
    });

    const status = await verify(controller, { force: true });

    expect(status).toBe(ACCOUNT_AUTH_STATUS.authenticated);
    expect(controller.initAgent).toHaveBeenCalledTimes(1);
    expect(controller.setConfig).toHaveBeenCalledWith(
      ACCOUNT_CONFIG_KEYS.authStatus,
      ACCOUNT_AUTH_STATUS.authenticated,
    );
  });

  it("signs out when the profile belongs to another account", async () => {
    const controller = createController({
      getProfile: jest.fn(
        async () =>
          ({
            did: "did:plc:someone-else",
            handle: "else.bsky.social",
          }) as Profile,
      ),
    });

    const status = await verify(controller);

    expect(status).toBe(ACCOUNT_AUTH_STATUS.signedOut);
  });

  it("signs out when the session is missing", async () => {
    const missing = new Error("Missing Bluesky session (signed out)");
    missing.name = "MissingBlueskySessionError";
    const controller = createController({
      initAgent: jest.fn(async () => {
        throw missing;
      }),
      isAgentReady: jest.fn(() => false),
    });

    const status = await verify(controller);

    expect(status).toBe(ACCOUNT_AUTH_STATUS.signedOut);
    expect(controller.setConfig).toHaveBeenCalledWith(
      ACCOUNT_CONFIG_KEYS.authStatus,
      ACCOUNT_AUTH_STATUS.signedOut,
    );
  });

  // Regression: Bluesky can revoke a session with no disconnect in Cyd. The
  // failed refresh takes the stored connection with it, but the error that
  // surfaces says only "Session expired", which matches nothing — so the
  // account went on reading as authenticated until something forced a check.
  it("signs out when the failed check left no stored connection", async () => {
    jest.mocked(getBlueskyConnection).mockResolvedValue(null);
    const controller = createController({
      getProfile: jest.fn(async () => {
        throw new Error("Session expired and no callback provided");
      }),
    });

    const status = await verify(controller);

    expect(status).toBe(ACCOUNT_AUTH_STATUS.signedOut);
    expect(controller.setConfig).toHaveBeenCalledWith(
      ACCOUNT_CONFIG_KEYS.authStatus,
      ACCOUNT_AUTH_STATUS.signedOut,
    );
  });

  it("signs out when the connection cannot be refreshed on init", async () => {
    jest.mocked(getBlueskyConnection).mockResolvedValue(null);
    const controller = createController({
      isAgentReady: jest.fn(() => false),
      initAgent: jest.fn(async () => {
        // atproto's TokenRefreshError: the message can be whatever the
        // authorization server sent back.
        throw new Error("The session was revoked");
      }),
    });

    expect(await verify(controller)).toBe(ACCOUNT_AUTH_STATUS.signedOut);
  });

  it("keeps the stored status when the connection outlives a failed check", async () => {
    const controller = createController({
      getProfile: jest.fn(async () => {
        throw new Error("Network request failed");
      }),
    });

    const status = await verify(controller);

    expect(getBlueskyConnection).toHaveBeenCalled();
    expect(status).toBe(ACCOUNT_AUTH_STATUS.authenticated);
  });

  it("keeps the stored status when the connection cannot be read", async () => {
    jest
      .mocked(getBlueskyConnection)
      .mockRejectedValue(new Error("SecureStore unavailable"));
    const controller = createController({
      getProfile: jest.fn(async () => {
        throw new Error("Network request failed");
      }),
    });

    expect(await verify(controller)).toBe(ACCOUNT_AUTH_STATUS.authenticated);
  });
});
