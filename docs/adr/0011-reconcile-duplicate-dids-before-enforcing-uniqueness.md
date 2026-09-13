# Reconcile duplicate DIDs before enforcing uniqueness

**Superseded on Mobile: the state this describes is unreachable here.**

The original decision was that Cyd Mobile migration would detect existing Bluesky local accounts sharing a Bluesky DID and flag them for explicit reconciliation — the person previews an idempotent union of Bluesky saved data and chooses the surviving local-account UUID and Bluesky account settings — rather than selecting one silently, after which one local account per DID is enforced so a Bluesky archive import has an unambiguous destination.

No Mobile migration ever performed that detection, and none could have needed to. `bsky_account.did` has carried a unique index since the same migration that added the column, in the same statement list and so in the same transaction, which means no Mobile database has ever held one Bluesky identity in two Bluesky local accounts. Every path that writes an account reuses the row the DID or handle already names, and Bluesky archive restore refuses an identity this installation holds and merges instead. Restoring an OS backup restores the index with it, so it does not produce the state either. The unique index permits several rows with no DID, but an account whose Bluesky identity is unknown is not a duplicate of anything.

So Mobile does not carry reconciliation. `chooseBlueskyArchiveImportDestination` refuses an archive it cannot place rather than choosing between two accounts, because a database holding one identity twice is a database Cyd did not build and has no way to reason about. What remains reachable, and is deliberately not handled, is an old Bluesky local account with no DID sitting beside a newer one that has it: nothing proves those are one identity, and guessing from a handle is what the DID exists to avoid.

This ADR stands for clients whose schema does permit the state.
