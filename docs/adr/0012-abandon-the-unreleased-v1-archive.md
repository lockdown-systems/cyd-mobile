# Abandon the unreleased version 1 archive

Cyd Mobile neither imports nor exports its unversioned Bluesky prototype archive, retrospectively called version 1, because it has no users and exposes mobile’s private runtime schema rather than the canonical interchange contract. Version 2 is the first supported Cyd Bluesky archive format; removing prototype compatibility avoids maintaining an unsafe filename-dependent extract-and-copy path or constraining the cross-client design around unused data.
