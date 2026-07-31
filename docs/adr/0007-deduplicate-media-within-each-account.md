# Deduplicate media within each Bluesky local account

Cyd Mobile stores full-size images and video content-addressably within each UUID-keyed Bluesky local account, and Bluesky saved records reference those assets rather than owning duplicate files. It does not deduplicate across Bluesky local accounts, so deleting, importing, or exporting one Bluesky local account never depends on another Bluesky local account’s storage while Cyd Bluesky archives at version 2 can package each unique asset once.
