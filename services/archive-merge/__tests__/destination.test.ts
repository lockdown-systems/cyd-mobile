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

  it("asks for reconciliation when duplicate local accounts hold the DID", () => {
    const first = identity("uuid-a", "did:plc:archive");
    const second = identity("uuid-b", "did:plc:archive");

    const destination = chooseBlueskyArchiveImportDestination("did:plc:archive", [
      first,
      identity("uuid-c", "did:plc:someone-else"),
      second,
    ]);

    expect(destination).toEqual({
      kind: "reconcile",
      did: "did:plc:archive",
      accounts: [first, second],
    });
  });
});
