jest.mock("@/services/bluesky-connection-store", () => ({
  getBlueskyConnection: jest.fn(),
}));

import { getBlueskyConnection } from "@/services/bluesky-connection-store";
import { migrateLegacyBlueskyConnections } from "../connection-migration";

describe("legacy Bluesky connection migration", () => {
  it("protects every database connection before credential columns are removed", async () => {
    const db = {
      getAllAsync: jest.fn(async () => [
        {
          uuid: "uuid-alice",
          did: "did:plc:alice",
          sessionJson: "alice-connection",
        },
        {
          uuid: "uuid-bob",
          did: "did:plc:bob",
          sessionJson: null,
        },
      ]),
    };
    jest
      .mocked(getBlueskyConnection)
      .mockResolvedValueOnce("alice-connection")
      .mockResolvedValueOnce(null);

    await migrateLegacyBlueskyConnections(db as never);

    expect(getBlueskyConnection).toHaveBeenNthCalledWith(1, {
      accountUUID: "uuid-alice",
      legacyDid: "did:plc:alice",
      legacyConnection: "alice-connection",
    });
    expect(getBlueskyConnection).toHaveBeenNthCalledWith(2, {
      accountUUID: "uuid-bob",
      legacyDid: "did:plc:bob",
      legacyConnection: null,
    });
  });

  it("stops the schema migration when protected storage is unavailable", async () => {
    const db = {
      getAllAsync: jest.fn(async () => [
        {
          uuid: "uuid-alice",
          did: "did:plc:alice",
          sessionJson: "alice-connection",
        },
      ]),
    };
    jest
      .mocked(getBlueskyConnection)
      .mockRejectedValueOnce(new Error("Keychain unavailable"));

    await expect(migrateLegacyBlueskyConnections(db as never)).rejects.toThrow(
      "Keychain unavailable",
    );
  });
});
