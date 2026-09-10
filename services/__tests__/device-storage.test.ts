import { getBackupEligibleDataRoot } from "../device-storage";

describe("device storage backup boundaries", () => {
  it("keeps committed Bluesky saved data in backup-eligible document storage", () => {
    expect(getBackupEligibleDataRoot()).toBe(
      "file:///mock/document/directory/",
    );
  });
});
