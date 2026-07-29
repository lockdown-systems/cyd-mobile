# Translate archives through private runtime storage

Cyd Mobile retains and migrates its existing private per-account runtime database rather than replacing it with the version 2 interchange schema. Dedicated version 2 adapters translate archive data at the boundary, allowing installed mobile data and mobile-specific persistence to evolve without coupling runtime migrations to the shared archive contract.
