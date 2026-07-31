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
    WHEN_UNLOCKED: "WHEN_UNLOCKED",
    getItemAsync: jest.fn(async (key: string) => mockProtectedValues.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      mockProtectedValues.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      mockProtectedValues.delete(key);
    }),
  }),
  { virtual: true },
);

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import {
  deleteBlueskyConnection,
  getBlueskyConnection,
  getBlueskyOAuthState,
  setBlueskyOAuthState,
  setBlueskyConnection,
} from "../bluesky-connection-store";

describe("BlueskyConnectionStore", () => {
  beforeEach(() => {
    mockLegacyValues.clear();
    mockProtectedValues.clear();
    jest.clearAllMocks();
  });

  it("migrates a working legacy connection to UUID-keyed protected storage", async () => {
    const did = "did:plc:alice";
    const accountUUID = "b13d55a0-82d4-46af-b0ba-1a6e1d863c00";
    const serializedConnection = JSON.stringify({
      tokenSet: { refresh_token: "refresh-token" },
      dpopKeyJwk: { kty: "EC", d: "private-key" },
    });
    const legacyKey = `@cyd/bluesky/session/${did}`;
    mockLegacyValues.set(legacyKey, serializedConnection);

    await expect(
      getBlueskyConnection({ accountUUID, legacyDid: did }),
    ).resolves.toBe(serializedConnection);

    expect(mockLegacyValues.has(legacyKey)).toBe(false);
    expect([...mockProtectedValues.values()]).toEqual([serializedConnection]);
    expect([...mockProtectedValues.keys()][0]).toContain(accountUUID);
    expect([...mockProtectedValues.keys()][0]).not.toContain(did);

    await expect(getBlueskyConnection({ accountUUID })).resolves.toBe(
      serializedConnection,
    );
  });

  it("isolates connections by local-account UUID and deletes only the selected connection", async () => {
    await setBlueskyConnection("uuid-alice", "alice-connection");
    await setBlueskyConnection("uuid-bob", "bob-connection");

    await expect(
      getBlueskyConnection({ accountUUID: "uuid-alice" }),
    ).resolves.toBe("alice-connection");
    await expect(
      getBlueskyConnection({ accountUUID: "uuid-bob" }),
    ).resolves.toBe("bob-connection");

    await deleteBlueskyConnection("uuid-alice");

    await expect(
      getBlueskyConnection({ accountUUID: "uuid-alice" }),
    ).resolves.toBeNull();
    await expect(
      getBlueskyConnection({ accountUUID: "uuid-bob" }),
    ).resolves.toBe("bob-connection");
  });

  it("retains the legacy connection when the protected write fails", async () => {
    const did = "did:plc:alice";
    const legacyKey = `@cyd/bluesky/session/${did}`;
    mockLegacyValues.set(legacyKey, "legacy-connection");
    jest
      .mocked(SecureStore.setItemAsync)
      .mockRejectedValueOnce(new Error("Keychain unavailable"));

    await expect(
      getBlueskyConnection({ accountUUID: "uuid-alice", legacyDid: did }),
    ).rejects.toThrow("Keychain unavailable");

    expect(mockLegacyValues.get(legacyKey)).toBe("legacy-connection");
    expect(mockProtectedValues.size).toBe(0);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it("finishes legacy cleanup when restarted after the protected write", async () => {
    const did = "did:plc:alice";
    const legacyKey = `@cyd/bluesky/session/${did}`;
    mockLegacyValues.set(legacyKey, "legacy-connection");
    jest
      .mocked(AsyncStorage.removeItem)
      .mockRejectedValueOnce(new Error("App terminated"));

    await expect(
      getBlueskyConnection({ accountUUID: "uuid-alice", legacyDid: did }),
    ).rejects.toThrow("App terminated");

    expect(mockLegacyValues.get(legacyKey)).toBe("legacy-connection");
    expect([...mockProtectedValues.values()]).toEqual(["legacy-connection"]);

    await expect(
      getBlueskyConnection({ accountUUID: "uuid-alice", legacyDid: did }),
    ).resolves.toBe("legacy-connection");
    expect(mockLegacyValues.has(legacyKey)).toBe(false);
  });

  it("protects a legacy runtime-database connection before returning it", async () => {
    await expect(
      getBlueskyConnection({
        accountUUID: "uuid-alice",
        legacyDid: "did:plc:alice",
        legacyConnection: "database-connection",
      }),
    ).resolves.toBe("database-connection");

    expect([...mockProtectedValues.values()]).toEqual(["database-connection"]);
  });

  it("does not let an interrupted disconnect restore a legacy connection", async () => {
    const did = "did:plc:alice";
    const legacyKey = `@cyd/bluesky/session/${did}`;
    mockLegacyValues.set(legacyKey, "legacy-connection");
    await setBlueskyConnection("uuid-alice", "protected-connection");
    jest
      .mocked(AsyncStorage.removeItem)
      .mockRejectedValueOnce(new Error("App terminated"));

    await expect(
      deleteBlueskyConnection("uuid-alice", did),
    ).rejects.toThrow("App terminated");

    await expect(
      deleteBlueskyConnection("uuid-alice", did),
    ).resolves.toBeUndefined();
    await expect(
      getBlueskyConnection({ accountUUID: "uuid-alice", legacyDid: did }),
    ).resolves.toBeNull();
  });

  it("keeps temporary OAuth state out of AsyncStorage and migrates in-flight state", async () => {
    await setBlueskyOAuthState("new-state", "new-state-secret");
    await expect(getBlueskyOAuthState("new-state")).resolves.toBe(
      "new-state-secret",
    );
    expect(mockLegacyValues.has("@cyd/bluesky/state/new-state")).toBe(false);

    mockLegacyValues.set(
      "@cyd/bluesky/state/in-flight-state",
      "legacy-state-secret",
    );
    await expect(getBlueskyOAuthState("in-flight-state")).resolves.toBe(
      "legacy-state-secret",
    );
    expect(
      mockLegacyValues.has("@cyd/bluesky/state/in-flight-state"),
    ).toBe(false);
  });
});
