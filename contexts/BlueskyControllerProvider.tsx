import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  BlueskyAccountController,
  type BlueskyProgress,
  type RateLimitInfo,
} from "@/controllers";

/**
 * Context value for the Bluesky controller
 */
interface BlueskyControllerContextValue {
  controller: BlueskyAccountController | null;
  progress: BlueskyProgress;
  rateLimitInfo: RateLimitInfo | null;
  isInitialized: boolean;
  isAgentReady: boolean;
  error: Error | null;

  // Re-authenticate if session expired
  requestReauthentication: () => void;
  reauthenticationRequested: boolean;

  // Refresh controller after re-authentication
  refreshController: () => Promise<void>;
}

const BlueskyControllerContext =
  createContext<BlueskyControllerContextValue | null>(null);

interface BlueskyControllerProviderProps {
  accountId: number;
  children: ReactNode;
}

/**
 * Provider component that manages the lifecycle of a BlueskyAccountController.
 * Automatically initializes the controller and its database when mounted,
 * and cleans up when unmounted.
 */
export function BlueskyControllerProvider({
  accountId,
  children,
}: BlueskyControllerProviderProps) {
  const controllerRef = useRef<BlueskyAccountController | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAgentReady, setIsAgentReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reauthenticationRequested, setReauthenticationRequested] =
    useState(false);

  const [progress, setProgress] = useState<BlueskyProgress>({
    postsSaved: 0,
    postsTotal: null,
    likesSaved: 0,
    likesTotal: null,
    bookmarksSaved: 0,
    bookmarksTotal: null,
    followsSaved: 0,
    followsTotal: null,
    conversationsSaved: 0,
    conversationsTotal: null,
    messagesSaved: 0,
    messagesTotal: null,
    postsDeleted: 0,
    postsToDelete: null,
    repostsDeleted: 0,
    repostsToDelete: null,
    likesDeleted: 0,
    likesToDelete: null,
    bookmarksDeleted: 0,
    bookmarksToDelete: null,
    messagesDeleted: 0,
    messagesToDelete: null,
    unfollowed: 0,
    toUnfollow: null,
    currentAction: "",
    isRunning: false,
    error: null,
  });

  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(
    null
  );

  // Initialize the controller
  const initController = useCallback(async () => {
    try {
      // Create controller
      const controller = new BlueskyAccountController(accountId);
      controllerRef.current = controller;

      // Set up callbacks
      controller.setProgressCallback(setProgress);
      controller.setRateLimitCallback(setRateLimitInfo);
      controller.setSessionExpiredCallback(async () => {
        setReauthenticationRequested(true);
      });

      // Initialize database
      await controller.initDB();
      setIsInitialized(true);

      // Try to initialize the agent (may fail if session expired)
      try {
        await controller.initAgent();
        setIsAgentReady(true);
      } catch (agentError) {
        // Agent initialization failed, likely need to re-authenticate
        console.warn("Agent initialization failed:", agentError);
        setReauthenticationRequested(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [accountId]);

  // Clean up the controller
  const cleanupController = useCallback(async () => {
    if (controllerRef.current) {
      await controllerRef.current.cleanup();
      controllerRef.current = null;
    }
    setIsInitialized(false);
    setIsAgentReady(false);
    setReauthenticationRequested(false);
  }, []);

  // Request re-authentication (called when session expires)
  const requestReauthentication = useCallback(() => {
    setReauthenticationRequested(true);
    setIsAgentReady(false);
  }, []);

  // Refresh controller after re-authentication
  const refreshController = useCallback(async () => {
    if (!controllerRef.current) {
      return;
    }

    try {
      await controllerRef.current.initAgent();
      setIsAgentReady(true);
      setReauthenticationRequested(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    initController();

    return () => {
      cleanupController();
    };
  }, [initController, cleanupController]);

  // Re-initialize if accountId changes
  useEffect(() => {
    cleanupController().then(() => {
      initController();
    });
  }, [accountId, cleanupController, initController]);

  const contextValue: BlueskyControllerContextValue = {
    controller: controllerRef.current,
    progress,
    rateLimitInfo,
    isInitialized,
    isAgentReady,
    error,
    requestReauthentication,
    reauthenticationRequested,
    refreshController,
  };

  return (
    <BlueskyControllerContext.Provider value={contextValue}>
      {children}
    </BlueskyControllerContext.Provider>
  );
}

/**
 * Hook to access the Bluesky controller context.
 * Must be used within a BlueskyControllerProvider.
 */
export function useBlueskyController(): BlueskyControllerContextValue {
  const context = useContext(BlueskyControllerContext);

  if (!context) {
    throw new Error(
      "useBlueskyController must be used within a BlueskyControllerProvider"
    );
  }

  return context;
}
