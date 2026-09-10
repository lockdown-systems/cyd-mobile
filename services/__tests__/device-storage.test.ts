import {
  ARCHIVE_EXPORT_DIRECTORY,
  ARCHIVE_STAGING_DIRECTORY,
  getArchiveExportStagingRoot,
  getArchiveStagingRoot,
  getBackupEligibleDataRoot,
} from "../device-storage";

// The config plugin is CommonJS, so it has no ES module entry point to import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const backupRules = require("@/plugins/android-backup-rules") as {
  ARCHIVE_STAGING_PATH: string;
  ARCHIVE_EXPORT_PATH: string;
};

describe("device storage backup boundaries", () => {
  it("keeps committed Bluesky saved data in backup-eligible document storage", () => {
    expect(getBackupEligibleDataRoot()).toBe(
      "file:///mock/document/directory/",
    );
  });

  it("stages archive imports in durable storage so they can resume", () => {
    expect(getArchiveStagingRoot()).toBe(
      "file:///mock/document/directory/archive-intake/",
    );
  });

  it("stages archive imports where Android backup rules exclude them", () => {
    expect(ARCHIVE_STAGING_DIRECTORY).toBe(backupRules.ARCHIVE_STAGING_PATH);
  });

  it("assembles archive exports in durable storage so they can resume", () => {
    expect(getArchiveExportStagingRoot()).toBe(
      "file:///mock/document/directory/archive-export/",
    );
  });

  it("stages archive exports where Android backup rules exclude them", () => {
    expect(ARCHIVE_EXPORT_DIRECTORY).toBe(backupRules.ARCHIVE_EXPORT_PATH);
  });
});
