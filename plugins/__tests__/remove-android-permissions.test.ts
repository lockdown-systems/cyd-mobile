const withRemovedPermissions = require("../remove-android-permissions");

jest.mock("expo/config-plugins", () => ({
  withAndroidManifest: jest.fn((config, action) =>
    action({
      ...config,
      modResults: config.modResults ?? { manifest: {} },
    }),
  ),
}));

describe("remove-android-permissions plugin", () => {
  it("adds tools namespace and remove directives for unwanted permissions", () => {
    const inputConfig = {
      modResults: {
        manifest: {
          $: {},
          "uses-permission": [
            { $: { "android:name": "android.permission.INTERNET" } },
            {
              $: {
                "android:name": "android.permission.READ_EXTERNAL_STORAGE",
              },
            },
          ],
        },
      },
    };

    const result = withRemovedPermissions(inputConfig);
    const manifest = result.modResults.manifest;

    expect(manifest.$["xmlns:tools"]).toBe("http://schemas.android.com/tools");

    const permissions = manifest["uses-permission"] as Array<{
      $: { "android:name": string; "tools:node"?: string };
    }>;

    expect(
      permissions.some(
        (perm) => perm.$["android:name"] === "android.permission.INTERNET",
      ),
    ).toBe(true);

    const readExternalPermission = permissions.find(
      (perm) =>
        perm.$["android:name"] === "android.permission.READ_EXTERNAL_STORAGE",
    );
    expect(readExternalPermission).toBeDefined();
    expect(readExternalPermission?.$["tools:node"]).toBe("remove");
  });

  it("is idempotent when applied multiple times", () => {
    const inputConfig = {
      modResults: {
        manifest: {
          $: {},
          "uses-permission": [
            {
              $: {
                "android:name": "android.permission.READ_EXTERNAL_STORAGE",
                "tools:node": "remove",
              },
            },
          ],
          "uses-permission-sdk-23": [
            {
              $: {
                "android:name": "android.permission.WRITE_EXTERNAL_STORAGE",
              },
            },
          ],
        },
      },
    };

    const once = withRemovedPermissions(inputConfig);
    const twice = withRemovedPermissions(once);

    const manifest = twice.modResults.manifest;
    const permissions = manifest["uses-permission"] as Array<{
      $: { "android:name": string; "tools:node"?: string };
    }>;

    const readExternalEntries = permissions.filter(
      (perm) =>
        perm.$["android:name"] === "android.permission.READ_EXTERNAL_STORAGE",
    );

    expect(readExternalEntries).toHaveLength(1);
    expect(readExternalEntries[0]?.$["tools:node"]).toBe("remove");
    expect(manifest["uses-permission-sdk-23"]).toEqual([]);
  });
});
