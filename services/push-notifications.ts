import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type PushTokenResult = {
  success: boolean;
  token?: string;
  platform?: "ios" | "android";
  error?: string;
};

function getExpoProjectId(): string | null {
  const easProjectId = (Constants as { easConfig?: { projectId?: string } })
    .easConfig?.projectId;
  if (easProjectId) {
    return easProjectId;
  }

  const expoExtraProjectId = (
    Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  )?.eas?.projectId;
  if (expoExtraProjectId) {
    return expoExtraProjectId;
  }

  const expoManifestProjectId = (
    Constants as { manifest2?: { extra?: { eas?: { projectId?: string } } } }
  ).manifest2?.extra?.eas?.projectId;

  return expoManifestProjectId ?? null;
}

/**
 * Configure notification handler for foreground notifications
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Request permission for push notifications
 * Returns true if permission was granted
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    console.log("Push notifications are not available in simulator");
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  if (existingStatus === Notifications.PermissionStatus.GRANTED) {
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === Notifications.PermissionStatus.GRANTED;
}

/**
 * Check if notification permission is granted
 */
export async function hasNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    return false;
  }

  const { status } = await Notifications.getPermissionsAsync();
  return status === Notifications.PermissionStatus.GRANTED;
}

/**
 * Register for push notifications and get the Expo push token
 */
export async function registerForPushNotifications(): Promise<PushTokenResult> {
  if (!Device.isDevice) {
    return {
      success: false,
      error: "Push notifications are not available in simulator",
    };
  }

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    return {
      success: false,
      error: "Push notification permission was denied",
    };
  }

  try {
    // Configure Android notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("scheduled-deletion", {
        name: "Scheduled Deletion",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#4A90D9",
      });
    }

    // Get Expo push token (works for both iOS and Android)
    // This token is sent to Expo's push service, which forwards to APNs/FCM
    const projectId = getExpoProjectId();
    if (!projectId) {
      return {
        success: false,
        error:
          "Missing EAS projectId for push notifications. Rebuild the app with EAS metadata available.",
      };
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return {
      success: true,
      token: tokenData.data, // ExponentPushToken[xxx]
      platform: Platform.OS as "ios" | "android",
    };
  } catch (error) {
    console.error("Error getting push token:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Add a listener for notification responses (when user taps a notification)
 * Returns a cleanup function to remove the listener
 */
export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void,
): () => void {
  const subscription =
    Notifications.addNotificationResponseReceivedListener(callback);
  return () => subscription.remove();
}

/**
 * Add a listener for received notifications (when notification arrives)
 * Returns a cleanup function to remove the listener
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void,
): () => void {
  const subscription = Notifications.addNotificationReceivedListener(callback);
  return () => subscription.remove();
}

/**
 * Get the last notification response (if app was opened via notification)
 */
export async function getLastNotificationResponse(): Promise<Notifications.NotificationResponse | null> {
  return await Notifications.getLastNotificationResponseAsync();
}

/**
 * Parse notification data to extract account info for deep linking
 */
export function parseNotificationData(
  notification: Notifications.Notification,
): {
  accountId?: number;
  accountUUID?: string;
  handle?: string;
  action?: string;
} | null {
  const data = notification.request.content.data;
  if (!data) {
    return null;
  }

  return {
    accountId: data.accountId as number | undefined,
    accountUUID: data.accountUUID as string | undefined,
    handle: data.handle as string | undefined,
    action: data.action as string | undefined,
  };
}
