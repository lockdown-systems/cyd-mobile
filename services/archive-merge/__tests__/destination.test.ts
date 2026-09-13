import type { LocalAccountIdentity } from "@/services/archive-restore";

import { chooseBlueskyArchiveImportDestination } from "../destination";

/**
 * Where a picked Cyd Bluesky archive is committed.
 *
 * Routing is the whole of the decision #97 owns: the same picked file becomes
 * a restore, a merge, or a reconciliation depending only on what this
 * installation already holds for the archive's DID.
 */

const identity = (
  uuid: string,
  did: string | null,
  handle = "somebody.bsky.social",
): LocalAccountIdentity => ({ uuid, did, handle });

describe("choosing where a Cyd Bluesky archive is committed", () => {
  it("restores an identity this installation does not hold", () => {
    const destination = chooseBlueskyArchiveImportDestination(
      "did:plc:archive",
      [identity("uuid-a", "did:plc:someone-else")],
    );

    expect(destination).toEqual({ kind: "restore" });
  });

  it("merges into the one Bluesky local account holding the DID", () => {
    const existing = identity("uuid-a", "did:plc:archive", "glitter.bsky.social");

    const destination = chooseBlueskyArchiveImportDestination(
      "did:plc:archive",
      [identity("uuid-b", "did:plc:someone-else"), existing],
    );

    expect(destination).toEqual({ kind: "merge", account: existing });
  });

  it("matches on the DID rather than the handle a local account is listed under", () => {
    const destination = chooseBlueskyArchiveImportDestination("did:plc:archive", [
      identity("uuid-a", null, "glitter.bsky.social"),
    ]);

    expect(destination).toEqual({ kind: "restore" });
  });

  /**
   * `bsky_account.did` is unique and has been since the column existed, so no
   * database Cyd Mobile built can reach this. If one ever does, an archive has
   * no unambiguous destination and there is nothing sensible to pick.
   */
  it("refuses rather than guess when two local accounts hold the DID", () => {
    expect(() =>
      chooseBlueskyArchiveImportDestination("did:plc:archive", [
        identity("uuid-a", "did:plc:archive"),
        identity("uuid-c", "did:plc:someone-else"),
        identity("uuid-b", "did:plc:archive"),
      ]),
    ).toThrow(/more than one Bluesky account/);
  });
});
