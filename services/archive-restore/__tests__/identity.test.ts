import {
  BlueskyArchiveRestoreError,
  chooseRestoredAccountHandle,
  chooseRestoredAccountUuid,
} from "..";

const ARCHIVE_UUID = "b67bfc6c-6155-47ef-8273-71593e04f01a";
const ARCHIVE_DID = "did:plc:yn45xekh5kqrat27w6rmafcg";

const newUuid = (): string => "11111111-2222-3333-4444-555555555555";

describe("choosing the restored account's UUID", () => {
  it("adopts the archive's UUID when nothing else uses it", () => {
    expect(
      chooseRestoredAccountUuid({
        archiveUuid: ARCHIVE_UUID,
        archiveDid: ARCHIVE_DID,
        existing: [{ uuid: "other-uuid", did: "did:plc:somebodyelse", handle: null }],
        newUuid,
      }),
    ).toEqual({ uuid: ARCHIVE_UUID, remapping: null });
  });

  it("remaps, and reports the remapping, when another identity holds the UUID", () => {
    const chosen = chooseRestoredAccountUuid({
      archiveUuid: ARCHIVE_UUID,
      archiveDid: ARCHIVE_DID,
      existing: [{ uuid: ARCHIVE_UUID, did: "did:plc:somebodyelse", handle: null }],
      newUuid,
    });

    expect(chosen.uuid).toBe("11111111-2222-3333-4444-555555555555");
    expect(chosen.remapping).toEqual({
      archiveUuid: ARCHIVE_UUID,
      assignedUuid: "11111111-2222-3333-4444-555555555555",
      reason: expect.stringMatching(/another Bluesky account/i),
    });
  });

  it("keeps generating until it finds a UUID nobody holds", () => {
    const generated = ["11111111-2222-3333-4444-555555555555", "fresh-uuid"];
    const chosen = chooseRestoredAccountUuid({
      archiveUuid: ARCHIVE_UUID,
      archiveDid: ARCHIVE_DID,
      existing: [
        { uuid: ARCHIVE_UUID, did: "did:plc:somebodyelse", handle: null },
        { uuid: "11111111-2222-3333-4444-555555555555", did: "did:plc:another", handle: null },
      ],
      newUuid: () => generated.shift() as string,
    });

    expect(chosen.uuid).toBe("fresh-uuid");
  });

  it("refuses to restore a DID this installation already has a local account for", () => {
    // Merging into an existing local account is a recovery union (#97), not a
    // restore, and doing it by accident would create a duplicate identity.
    expect(() =>
      chooseRestoredAccountUuid({
        archiveUuid: ARCHIVE_UUID,
        archiveDid: ARCHIVE_DID,
        existing: [{ uuid: "some-other-uuid", did: ARCHIVE_DID, handle: null }],
        newUuid,
      }),
    ).toThrow(BlueskyArchiveRestoreError);
  });

  it("adopts the archive UUID even when a local account holds it for the same DID", () => {
    // Nothing should reach here — the DID check above rejects first — so this
    // pins the order of the two rules rather than a reachable case.
    expect(() =>
      chooseRestoredAccountUuid({
        archiveUuid: ARCHIVE_UUID,
        archiveDid: ARCHIVE_DID,
        existing: [{ uuid: ARCHIVE_UUID, did: ARCHIVE_DID, handle: null }],
        newUuid,
      }),
    ).toThrow(/already has a Bluesky account/i);
  });
});

describe("choosing the restored account's handle", () => {
  it("keeps the handle the archive carries", () => {
    expect(
      chooseRestoredAccountHandle({
        archiveHandle: "glittertop.bsky.social",
        archiveDid: ARCHIVE_DID,
        existing: [
          { uuid: "other", did: "did:plc:somebodyelse", handle: "other.bsky.social" },
        ],
      }),
    ).toBe("glittertop.bsky.social");
  });

  it("falls back to the DID when another account is listed under that handle", () => {
    // Handles move between Bluesky identities; a local account still holding
    // the old one must not be confused with this archive's.
    expect(
      chooseRestoredAccountHandle({
        archiveHandle: "glittertop.bsky.social",
        archiveDid: ARCHIVE_DID,
        existing: [
          {
            uuid: "other",
            did: "did:plc:somebodyelse",
            handle: "glittertop.bsky.social",
          },
        ],
      }),
    ).toBe(ARCHIVE_DID);
  });
});
