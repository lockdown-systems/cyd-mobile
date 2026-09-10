import type { AppBskyActorDefs } from "@atproto/api";

import type { BlueskyAccountController } from "@/controllers/BlueskyAccountController";
import {
  ACCOUNT_AUTH_STATUS,
  ACCOUNT_CONFIG_KEYS,
  type AccountAuthStatusValue,
} from "@/controllers/config";
import type { AccountListItem } from "@/database/accounts";

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
});
