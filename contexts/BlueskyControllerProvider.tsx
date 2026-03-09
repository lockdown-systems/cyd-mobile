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
  getBlueskyController,
  type BlueskyAccountController,
  type BlueskyProgress,
  type RateLimitInfo,
} from "@/controllers";
import { createInitialProgress } from "@/controllers/bluesky/types";

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
  accountUUID: string;
  children: ReactNode;
}

/**
 * Provider component that manages the lifecycle of a BlueskyAccountController.
 * Automatically initializes the controller and its database when mounted,
 * and cleans up when unmounted.
 */
export function BlueskyControllerProvider({
  accountId,
  accountUUID,
  children,
}: BlueskyControllerProviderProps) {
  const controllerRef = useRef<BlueskyAccountController | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAgentReady, setIsAgentReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reauthenticationRequested, setReauthenticationRequested] =
    useState(false);

  const [progress, setProgress] = useState<BlueskyProgress>(
    createInitialProgress(),
  );

  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(
    null,
  );

  // Initialize the controller
  const initController = useCallback(async () => {
    if (controllerRef.current) {
      return;
    }

    try {
      const controller = await getBlueskyController(accountId, accountUUID);
      controllerRef.current = controller;

      // Set up callbacks
      controller.setProgressCallback(setProgress);
      controller.setRateLimitCallback(setRateLimitInfo);
      controller.setSessionExpiredCallback(async () => {
        setReauthenticationRequested(true);
      });

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
  }, [accountId, accountUUID]);

  // Clean up local refs and state only — the controller-manager owns the
  // controller lifecycle, so we do not dispose or close the DB here.
  const cleanupController = useCallback(async () => {
    const controller = controllerRef.current;
    controllerRef.current = null;

    if (controller) {
      controller.clearProgressCallback();
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

  // Initialize/reinitialize when account changes
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await cleanupController();
      if (!cancelled) {
        await initController();
      }
    })();

    return () => {
      cancelled = true;
      void cleanupController();
    };
  }, [accountId, accountUUID, cleanupController, initController]);

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
      "useBlueskyController must be used within a BlueskyControllerProvider",
    );
  }

  return context;
}
