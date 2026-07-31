import type { ConfigContext } from "expo/config";

import createConfig from "../../app.config";

describe("native device backup configuration", () => {
  it("allows normal data backup while SecureStore excludes unrecoverable Android secrets", () => {
    const config = createConfig({ config: {} } as ConfigContext);

    expect(config.android?.allowBackup).toBe(true);
    expect(config.plugins).toContainEqual([
      "expo-secure-store",
      { configureAndroidBackup: true },
    ]);
  });
});
