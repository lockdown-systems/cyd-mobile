import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

import {
  addNotificationReceivedListener,
  addNotificationResponseListener,
  configureNotificationHandler,
  getLastNotificationResponse,
  parseNotificationData,
} from "@/services/push-notifications";

/**
 * Hook to handle push notifications and navigate to appropriate screens.
 * Should be used in the root layout component.
 */
export function useNotificationHandler() {
  const router = useRouter();
  const responseListenerRef = useRef<(() => void) | null>(null);
  const receivedListenerRef = useRef<(() => void) | null>(null);

  /**
   * Handle notification response (when user taps on notification)
   */
  const handleNotificationResponse = useCallback(
    (accountUUID?: string) => {
      if (accountUUID) {
        // Navigate to the schedule tab's review screen for this account
        router.push({
          pathname: "/account/[accountId]",
          params: {
            accountId: accountUUID,
            initialTab: "schedule",
            scheduleShowReview: "true",
          },
        });
      }
    },
    [router]
  );

  useEffect(() => {
    // Configure notification handler for foreground notifications
    configureNotificationHandler();

    // Set up listener for notification taps
    responseListenerRef.current = addNotificationResponseListener(
      (response) => {
        console.log("Notification tapped:", response);
        const data = parseNotificationData(response.notification);
        if (data?.action === "scheduled_deletion") {
          handleNotificationResponse(data.accountUUID);
        }
      }
    );

    // Set up listener for received notifications (foreground)
    receivedListenerRef.current = addNotificationReceivedListener(
      (notification) => {
        console.log("Notification received:", notification);
        // We could show an in-app banner here if needed
      }
    );

    // Check if app was opened from a notification
    void (async () => {
      const lastResponse = await getLastNotificationResponse();
      if (lastResponse) {
        console.log("App opened from notification:", lastResponse);
        const data = parseNotificationData(lastResponse.notification);
        if (data?.action === "scheduled_deletion") {
          // Small delay to ensure navigation is ready
          setTimeout(() => {
            handleNotificationResponse(data.accountUUID);
          }, 500);
        }
      }
    })();

    return () => {
      // Clean up listeners
      responseListenerRef.current?.();
      receivedListenerRef.current?.();
    };
  }, [handleNotificationResponse]);
}
