import {
  buildBlueskyArchiveTemporaryPaths,
  getBackupEligibleDataRoot,
} from "../device-storage";

describe("device storage backup boundaries", () => {
  it("keeps committed account data in backup-eligible document storage", () => {
    expect(getBackupEligibleDataRoot()).toBe(
      "file:///mock/document/directory/",
    );
  });

  it("keeps archive staging and reproducible caches in excluded cache storage", () => {
    expect(buildBlueskyArchiveTemporaryPaths("job-123")).toEqual({
      rootDir: "file:///mock/cache/directory/bluesky-archives/",
      stagingDir:
        "file:///mock/cache/directory/bluesky-archives/staging/job-123/",
      reproducibleCacheDir:
        "file:///mock/cache/directory/bluesky-archives/reproducible/job-123/",
    });
  });
});
