import type { ConfigContext } from "expo/config";

import createConfig from "../../app.config";

const BACKUP_RULES_PLUGIN = "./plugins/android-backup-rules";

function pluginIndex(
  plugins: NonNullable<ReturnType<typeof createConfig>["plugins"]>,
  name: string,
): number {
  return plugins.findIndex((plugin) =>
    Array.isArray(plugin) ? plugin[0] === name : plugin === name,
  );
}

describe("native device backup configuration", () => {
  it("allows normal data backup", () => {
    const config = createConfig({ config: {} } as ConfigContext);

    expect(config.android?.allowBackup).toBe(true);
  });

  it("declines the backup rules bundled with expo-secure-store", () => {
    // Those rules include only the sharedpref domain, and any <include> opts
    // out of Android's back-up-everything default, so they would drop the
    // app's databases and archives from every backup.
    const config = createConfig({ config: {} } as ConfigContext);

    expect(config.plugins).toContainEqual([
      "expo-secure-store",
      { configureAndroidBackup: false },
    ]);
  });

  it("supplies its own backup rules instead", () => {
    const config = createConfig({ config: {} } as ConfigContext);

    expect(config.plugins).toContain(BACKUP_RULES_PLUGIN);
  });

  it("applies its own rules after expo-secure-store so they win", () => {
    const config = createConfig({ config: {} } as ConfigContext);
    const plugins = config.plugins ?? [];

    expect(pluginIndex(plugins, BACKUP_RULES_PLUGIN)).toBeGreaterThan(
      pluginIndex(plugins, "expo-secure-store"),
    );
  });
});
