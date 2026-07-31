import { classifyBlueskyArchiveMetadata } from "../archive-metadata";

const canonicalMetadata = {
  format: "cyd-archive",
  platform: "bluesky",
  version: 2,
  createdAt: "2026-01-15T12:00:00.000Z",
  accountDid: "did:plc:canonicalalice",
  accountUuid: "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12",
  completeness: "complete",
};

describe("Cyd Bluesky archive metadata", () => {
  it("recognizes canonical Bluesky v2 metadata from internal content", () => {
    expect(classifyBlueskyArchiveMetadata(canonicalMetadata)).toEqual({
      supported: true,
      metadata: canonicalMetadata,
    });
  });

  it("ignores reserved unknown fields", () => {
    expect(
      classifyBlueskyArchiveMetadata({
        ...canonicalMetadata,
        futureOptionalField: "ignored",
      }),
    ).toEqual({ supported: true, metadata: canonicalMetadata });
  });

  it("rejects the unversioned mobile prototype explicitly", () => {
    const result = classifyBlueskyArchiveMetadata({
      type: "bluesky",
      uuid: "d628f5e2-44d2-465c-8b96-3529a614c2d1",
      exportTimestamp: "2026-01-11T05:28:46.071Z",
      account: { handle: "alice.test" },
    });

    expect(result).toEqual({
      supported: false,
      reason: "legacy",
      error: "Unsupported legacy Bluesky archive format.",
    });
  });

  it("rejects newer Bluesky archive versions explicitly", () => {
    expect(
      classifyBlueskyArchiveMetadata({ ...canonicalMetadata, version: 3 }),
    ).toEqual({
      supported: false,
      reason: "newer-version",
      error: "Unsupported newer Bluesky archive version 3.",
    });
  });

  it("rejects another platform explicitly", () => {
    expect(
      classifyBlueskyArchiveMetadata({
        ...canonicalMetadata,
        platform: "mastodon",
      }),
    ).toEqual({
      supported: false,
      reason: "platform",
      error: "Unsupported archive platform: mastodon.",
    });
  });

  it.each([
    ["a missing discriminator", {}],
    ["a malformed version", { ...canonicalMetadata, version: "2" }],
    ["an invalid timestamp", { ...canonicalMetadata, createdAt: "today" }],
    [
      "a nonexistent calendar timestamp",
      { ...canonicalMetadata, createdAt: "2026-02-30T12:00:00.000Z" },
    ],
    ["an invalid DID", { ...canonicalMetadata, accountDid: "alice.test" }],
    ["an invalid UUID", { ...canonicalMetadata, accountUuid: "not-a-uuid" }],
    [
      "an invalid completeness value",
      { ...canonicalMetadata, completeness: "mostly-complete" },
    ],
  ])("rejects %s as invalid or corrupt", (_description, metadata) => {
    const result = classifyBlueskyArchiveMetadata(metadata);

    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.reason).toBe("invalid");
      expect(result.error).toMatch(/^Invalid or corrupt Bluesky archive:/);
    }
  });
});
