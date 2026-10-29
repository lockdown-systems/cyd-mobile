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

function createConfigWithEnv(
  env: Record<string, string | undefined>,
): ReturnType<typeof createConfig> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
  try {
    return createConfig({ config: {} } as ConfigContext);
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
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

describe("Android distribution builds", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ANDROID_DISTRIBUTION = process.env.ANDROID_DISTRIBUTION;
    delete process.env.ANDROID_DISTRIBUTION;
  });

  afterEach(() => {
    if (savedEnv.ANDROID_DISTRIBUTION === undefined) {
      delete process.env.ANDROID_DISTRIBUTION;
    } else {
      process.env.ANDROID_DISTRIBUTION = savedEnv.ANDROID_DISTRIBUTION;
    }
  });

  it("keeps the Play Store application ID by default", () => {
    const config = createConfigWithEnv({});

    expect(config.android?.package).toBe("systems.lockdown.cydmobile");
    expect(config.extra?.androidDistribution).toBe("play");
    expect(config.android?.googleServicesFile).toBe("./google-services.json");
  });

  it("switches to the alt application ID for the non-Play build", () => {
    const config = createConfigWithEnv({ ANDROID_DISTRIBUTION: "other" });

    expect(config.android?.package).toBe("systems.lockdown.cydmobile.alt");
    expect(config.extra?.androidDistribution).toBe("other");
    expect(config.android?.googleServicesFile).toBe(
      "./google-services-alt.json",
    );
  });

  it("defaults the Google Play product IDs to the shared catalog", () => {
    const config = createConfigWithEnv({});

    expect(config.extra?.googlePlayAnnualProductId).toBe("premium_annual");
    expect(config.extra?.googlePlayMonthlyProductId).toBe("premium_monthly");
  });

  it("lets the environment override the Google Play product IDs", () => {
    const config = createConfigWithEnv({
      GOOGLE_PLAY_ANNUAL_PRODUCT_ID: "play_annual",
      GOOGLE_PLAY_MONTHLY_PRODUCT_ID: "play_monthly",
    });

    expect(config.extra?.googlePlayAnnualProductId).toBe("play_annual");
    expect(config.extra?.googlePlayMonthlyProductId).toBe("play_monthly");
  });
});
