# Export a point-in-time account snapshot

Cyd Mobile briefly pauses account-mutating jobs to create a SQLite backup and transactional inventory of referenced media, then resumes normal work while hashing and packaging that staged point-in-time snapshot. Assets missing or changed before staging completes are represented and reported as unavailable rather than silently omitted, so the resulting archive is internally consistent and its completeness claim is honest.
