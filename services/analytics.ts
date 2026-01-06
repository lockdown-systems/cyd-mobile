import { Platform } from "react-native";

import type { PlausibleEventName } from "@/types/analytics";

/**
 * Plausible domains for tracking events
 * These match the domains used in the desktop app's config files
 */
const PROD_PLAUSIBLE_DOMAIN = "plausible-app.cyd.social";
const DEV_PLAUSIBLE_DOMAIN = "dev-plausible-app.cyd.social";

/**
 * Get the appropriate Plausible domain based on the environment
 */
function getPlausibleDomain(): string {
  return __DEV__ ? DEV_PLAUSIBLE_DOMAIN : PROD_PLAUSIBLE_DOMAIN;
}

/**
 * Build a user agent string that identifies the platform (iOS or Android)
 * This helps Plausible distinguish between mobile platforms
 */
function buildUserAgent(): string {
  const os = Platform.OS === "ios" ? "iOS" : "Android";
  const version = Platform.Version;
  return `CydMobile/1.0 (${os} ${version})`;
}

/**
 * Track an event using the Plausible Events API
 * https://plausible.io/docs/events-api
 *
 * Events are sent asynchronously without blocking the caller.
 * Errors are silently logged to console to avoid disrupting the user experience.
 *
 * @param eventName - The name of the event to track (from PlausibleEvents)
 */
export function trackEvent(eventName: PlausibleEventName): void {
  const plausibleDomain = getPlausibleDomain();
  const userAgent = buildUserAgent();

  // Run the fetch request asynchronously without blocking
  // Use void to explicitly ignore the promise returned by the IIFE
  void (async () => {
    try {
      await fetch("https://plausible.io/api/event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": userAgent,
        },
        body: JSON.stringify({
          name: eventName,
          url: `https://${plausibleDomain}/`,
          domain: plausibleDomain,
        }),
      });
    } catch (error) {
      // Fail silently
      console.warn("[Analytics] trackEvent error:", error);
    }
  })();
}
