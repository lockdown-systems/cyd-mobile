const mockConstants = {
  easConfig: undefined as { projectId?: string } | undefined,
  expoConfig: undefined as
    | { extra?: { eas?: { projectId?: string } } }
    | undefined,
  manifest2: undefined as
    | { extra?: { eas?: { projectId?: string } } }
    | undefined,
};

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: mockConstants,
}));

jest.mock("expo-device", () => ({
  __esModule: true,
  isDevice: true,
}));

jest.mock("expo-notifications", () => ({
  __esModule: true,
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  AndroidImportance: {
    HIGH: "high",
  },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

const Constants = require("expo-constants").default as typeof mockConstants;
const Device = require("expo-device") as { isDevice: boolean };
const Notifications = require("expo-notifications") as {
  PermissionStatus: { GRANTED: string };
  getPermissionsAsync: jest.Mock;
  getExpoPushTokenAsync: jest.Mock;
};
const { registerForPushNotifications } = require("../push-notifications") as {
  registerForPushNotifications: () => Promise<{
    success: boolean;
    error?: string;
  }>;
};

describe("push-notifications registerForPushNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConstants.easConfig = undefined;
    mockConstants.expoConfig = undefined;
    mockConstants.manifest2 = undefined;

    Device.isDevice = true;

    Notifications.getPermissionsAsync.mockResolvedValue({
      status: Notifications.PermissionStatus.GRANTED,
    });
    Notifications.getExpoPushTokenAsync.mockResolvedValue({
      data: "ExponentPushToken[test]",
    });
  });

  it("uses easConfig.projectId when available", async () => {
    Constants.easConfig = { projectId: "eas-project-id" };

    const result = await registerForPushNotifications();

    expect(result.success).toBe(true);
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "eas-project-id",
    });
  });

  it("falls back to expoConfig.extra.eas.projectId", async () => {
    Constants.expoConfig = { extra: { eas: { projectId: "expo-extra-id" } } };

    const result = await registerForPushNotifications();

    expect(result.success).toBe(true);
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "expo-extra-id",
    });
  });

  it("falls back to manifest2.extra.eas.projectId", async () => {
    Constants.manifest2 = { extra: { eas: { projectId: "manifest2-id" } } };

    const result = await registerForPushNotifications();

    expect(result.success).toBe(true);
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "manifest2-id",
    });
  });

  it("returns setup error when projectId is missing", async () => {
    const result = await registerForPushNotifications();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing EAS projectId");
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });
});
