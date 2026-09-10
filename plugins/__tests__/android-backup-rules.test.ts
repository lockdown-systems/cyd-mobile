const withAndroidBackupRules = require("../android-backup-rules");

jest.mock("expo/config-plugins", () => ({
  withAndroidManifest: jest.fn((config, action) =>
    action({
      ...config,
      modResults: config.modResults ?? { manifest: {} },
    }),
  ),
  withDangerousMod: jest.fn((config) => config),
}));

function applyPlugin(manifest: unknown) {
  return withAndroidBackupRules({ modResults: { manifest } });
}

function baseManifest() {
  return { application: [{ $: { "android:allowBackup": "true" } }] };
}

describe("android-backup-rules plugin", () => {
  it("points the manifest at our own backup rule resources", () => {
    const result = applyPlugin(baseManifest());
    const application = result.modResults.manifest.application[0];

    expect(application.$["android:fullBackupContent"]).toBe(
      "@xml/cyd_backup_rules",
    );
    expect(application.$["android:dataExtractionRules"]).toBe(
      "@xml/cyd_data_extraction_rules",
    );
  });

  it("leaves android:allowBackup alone, since app.config.ts owns it", () => {
    const result = applyPlugin(baseManifest());

    expect(
      result.modResults.manifest.application[0].$["android:allowBackup"],
    ).toBe("true");
  });

  it("overrides rules left behind by another plugin", () => {
    const result = applyPlugin({
      application: [
        {
          $: {
            "android:fullBackupContent": "@xml/secure_store_backup_rules",
            "android:dataExtractionRules":
              "@xml/secure_store_data_extraction_rules",
          },
        },
      ],
    });
    const application = result.modResults.manifest.application[0];

    expect(application.$["android:fullBackupContent"]).toBe(
      "@xml/cyd_backup_rules",
    );
    expect(application.$["android:dataExtractionRules"]).toBe(
      "@xml/cyd_data_extraction_rules",
    );
  });

  it("throws when the manifest has no application element", () => {
    expect(() => applyPlugin({})).toThrow(/no <application> element/);
  });

  describe("rule contents", () => {
    const { BACKUP_RULES_XML, DATA_EXTRACTION_RULES_XML } =
      withAndroidBackupRules;

    it("excludes the SecureStore preferences from every backup path", () => {
      // Keystore-encrypted credentials cannot be decrypted on another device.
      const cloudBackup = DATA_EXTRACTION_RULES_XML.split("<device-transfer>")[0];
      const deviceTransfer =
        DATA_EXTRACTION_RULES_XML.split("<device-transfer>")[1];

      for (const rules of [BACKUP_RULES_XML, cloudBackup, deviceTransfer]) {
        expect(rules).toContain(
          '<exclude domain="sharedpref" path="SecureStore"/>',
        );
      }
    });

    it("keeps databases backup-eligible rather than relying on defaults", () => {
      // Any <include> opts out of Android's back-up-everything default, so the
      // file domain has to be named explicitly or main.db is silently dropped.
      expect(BACKUP_RULES_XML).toContain('<include domain="file" path="."/>');
      expect(DATA_EXTRACTION_RULES_XML).toContain(
        '<include domain="file" path="."/>',
      );
    });

    it("keeps archives out of cloud backup but inside device transfer", () => {
      // Cloud backup is capped at 25 MB and is skipped entirely when exceeded;
      // device transfer allows roughly 2 GB.
      const [cloudBackup, deviceTransfer] =
        DATA_EXTRACTION_RULES_XML.split("<device-transfer>");

      expect(cloudBackup).toContain('<exclude domain="file" path="accounts"/>');
      expect(deviceTransfer).not.toContain(
        '<exclude domain="file" path="accounts"/>',
      );
    });

    it("keeps in-progress archive import staging out of every backup path", () => {
      // Staging is half-unpacked working state; the committed account data it
      // becomes is backed up on its own.
      const [cloudBackup, deviceTransfer] =
        DATA_EXTRACTION_RULES_XML.split("<device-transfer>");

      for (const rules of [BACKUP_RULES_XML, cloudBackup, deviceTransfer]) {
        expect(rules).toContain(
          '<exclude domain="file" path="archive-intake"/>',
        );
      }
    });

    it("keeps in-progress archive export staging out of every backup path", () => {
      // A half-written archive is working state, and the account data it is
      // built from is backed up on its own.
      const [cloudBackup, deviceTransfer] =
        DATA_EXTRACTION_RULES_XML.split("<device-transfer>");

      for (const rules of [BACKUP_RULES_XML, cloudBackup, deviceTransfer]) {
        expect(rules).toContain(
          '<exclude domain="file" path="archive-export"/>',
        );
      }
    });

    it("mirrors the cloud rules on Android 11 and lower", () => {
      // full-backup-content has no device-transfer path.
      expect(BACKUP_RULES_XML).toContain(
        '<exclude domain="file" path="accounts"/>',
      );
    });
  });
});
