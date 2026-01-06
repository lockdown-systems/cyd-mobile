/**
 * Plausible analytics event types for Cyd Mobile
 * These events mirror the desktop app's PlausibleEvents for the Bluesky platform
 */

export const PlausibleEvents = Object.freeze({
  // App lifecycle
  APP_OPENED: "App Opened",

  // Bluesky authentication
  BLUESKY_USER_SIGNED_IN: "Bluesky User Signed In",

  // Bluesky jobs - these correspond to BlueskyJobType in job-types.ts
  BLUESKY_JOB_STARTED_VERIFY_AUTHORIZATION:
    "Bluesky Job Started: verifyAuthorization",
  BLUESKY_JOB_STARTED_SAVE_POSTS: "Bluesky Job Started: savePosts",
  BLUESKY_JOB_STARTED_SAVE_LIKES: "Bluesky Job Started: saveLikes",
  BLUESKY_JOB_STARTED_SAVE_BOOKMARKS: "Bluesky Job Started: saveBookmarks",
  BLUESKY_JOB_STARTED_SAVE_CHAT_CONVOS: "Bluesky Job Started: saveChatConvos",
  BLUESKY_JOB_STARTED_SAVE_CHAT_MESSAGES:
    "Bluesky Job Started: saveChatMessages",
});

export type PlausibleEventName =
  (typeof PlausibleEvents)[keyof typeof PlausibleEvents];
