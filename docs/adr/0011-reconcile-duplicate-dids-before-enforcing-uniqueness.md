# Reconcile duplicate DIDs before enforcing uniqueness

Cyd Mobile migration detects existing local accounts that share a Bluesky DID and flags them for explicit reconciliation rather than selecting one silently. The user previews an idempotent union of saved data and chooses the surviving local-account UUID and settings; after duplicates are resolved, mobile enforces one local account per DID so archive imports have an unambiguous destination.
