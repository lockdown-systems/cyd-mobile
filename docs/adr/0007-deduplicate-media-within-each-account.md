# Deduplicate media within each local account

Cyd Mobile stores full-size images and video content-addressably within each UUID-keyed local account, and saved records reference those assets rather than owning duplicate files. It does not deduplicate across accounts, so deleting, importing, or exporting one account never depends on another account’s storage while version 2 archives can package each unique asset once.
