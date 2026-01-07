import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

import {
  clearCydAccountCredentials,
  getCydAccountCredentials,
  setCydAccountCredentials,
} from "@/database/cyd-account";
import CydAPIClient from "@/services/cyd-api-client";

// Configuration - same as production cyd desktop app
const API_URL = "https://api.cyd.social";
const DASH_URL = "https://dash.cyd.social";

export type CydAccountState = {
  isSignedIn: boolean;
  userEmail: string | null;
  isLoading: boolean;
};

export type CydAccountContextType = {
  state: CydAccountState;
  apiClient: CydAPIClient;
  signIn: (
    email: string,
    verificationCode: string,
    subscribeToNewsletter: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  sendVerificationCode: (
    email: string
  ) => Promise<{ success: boolean; error?: string }>;
  refreshState: () => Promise<void>;
  getDashboardURL: () => string;
};

const CydAccountContext = createContext<CydAccountContextType | null>(null);

export function useCydAccount(): CydAccountContextType {
  const context = useContext(CydAccountContext);
  if (!context) {
    throw new Error("useCydAccount must be used within a CydAccountProvider");
  }
  return context;
}

type CydAccountProviderProps = {
  children: React.ReactNode;
};

export function CydAccountProvider({ children }: CydAccountProviderProps) {
  const [state, setState] = useState<CydAccountState>({
    isSignedIn: false,
    userEmail: null,
    isLoading: true,
  });

  const apiClient = useMemo(() => new CydAPIClient(API_URL, DASH_URL), []);

  const refreshState = useCallback(async () => {
    try {
      const credentials = await getCydAccountCredentials();

      if (credentials.userEmail && credentials.deviceToken) {
        apiClient.setCredentials(
          credentials.userEmail,
          credentials.deviceToken
        );

        // Verify the session is still valid
        const isValid = await apiClient.ping();

        setState({
          isSignedIn: isValid,
          userEmail: isValid ? credentials.userEmail : null,
          isLoading: false,
        });

        if (!isValid) {
          // Clear invalid credentials
          await clearCydAccountCredentials();
        }
      } else {
        setState({
          isSignedIn: false,
          userEmail: null,
          isLoading: false,
        });
      }
    } catch (error) {
      console.error("Error refreshing Cyd account state:", error);
      setState({
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
      });
    }
  }, [apiClient]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const sendVerificationCode = useCallback(
    async (email: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await apiClient.authenticate({ email });

        if (typeof response === "boolean") {
          if (response) {
            apiClient.setUserEmail(email);
            return { success: true };
          }
          return { success: false, error: "Authentication failed" };
        }

        if (response.error) {
          if (response.status === 403) {
            return {
              success: false,
              error: "Sign-in is restricted for this account",
            };
          }
          return { success: false, error: response.message };
        }

        return { success: true };
      } catch (error) {
        console.error("Error sending verification code:", error);
        return {
          success: false,
          error: "Failed to send verification code. Please try again.",
        };
      }
    },
    [apiClient]
  );

  const signIn = useCallback(
    async (
      email: string,
      verificationCode: string,
      subscribeToNewsletter: boolean
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        // Get device description
        const deviceDescription = `Cyd Mobile on ${
          Platform.OS === "ios" ? "iOS" : "Android"
        }`;

        // Register the device with the verification code
        const registerResponse = await apiClient.registerDevice({
          email,
          verification_code: verificationCode,
          description: deviceDescription,
          device_type: "mobile",
        });

        if ("error" in registerResponse) {
          return {
            success: false,
            error: "Invalid verification code. Please try again.",
          };
        }

        // Save credentials
        await setCydAccountCredentials({
          userEmail: email,
          deviceToken: registerResponse.device_token,
          deviceUUID: registerResponse.uuid,
        });

        // Set credentials in the API client
        apiClient.setCredentials(email, registerResponse.device_token);

        // Verify we can ping the server
        const pingResult = await apiClient.ping();
        if (!pingResult) {
          return {
            success: false,
            error: "Failed to verify device registration. Please try again.",
          };
        }

        // Subscribe to newsletter if requested
        if (subscribeToNewsletter) {
          try {
            await apiClient.postNewsletter({ email });
          } catch (e) {
            // Silently log and continue
            console.log("Error subscribing to newsletter:", e);
          }
        }

        // Update user activity
        try {
          await apiClient.postUserActivity();
        } catch (e) {
          console.log("Error updating user activity:", e);
        }

        setState({
          isSignedIn: true,
          userEmail: email,
          isLoading: false,
        });

        return { success: true };
      } catch (error) {
        console.error("Error signing in:", error);
        return {
          success: false,
          error: "Failed to sign in. Please try again.",
        };
      }
    },
    [apiClient]
  );

  const signOut = useCallback(async () => {
    try {
      // Try to delete the device from the server
      const credentials = await getCydAccountCredentials();
      if (credentials.deviceUUID) {
        try {
          await apiClient.deleteDevice({ uuid: credentials.deviceUUID });
        } catch (e) {
          console.log("Error deleting device from server:", e);
        }
      }

      // Clear local credentials
      await clearCydAccountCredentials();
      apiClient.setCredentials(null, null);

      setState({
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
      });
    } catch (error) {
      console.error("Error signing out:", error);
      // Still clear local state even if server call fails
      await clearCydAccountCredentials();
      apiClient.setCredentials(null, null);
      setState({
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
      });
    }
  }, [apiClient]);

  const getDashboardURL = useCallback(() => {
    return apiClient.getDashboardURL();
  }, [apiClient]);

  const contextValue = useMemo(
    () => ({
      state,
      apiClient,
      signIn,
      signOut,
      sendVerificationCode,
      refreshState,
      getDashboardURL,
    }),
    [
      state,
      apiClient,
      signIn,
      signOut,
      sendVerificationCode,
      refreshState,
      getDashboardURL,
    ]
  );

  return (
    <CydAccountContext.Provider value={contextValue}>
      {children}
    </CydAccountContext.Provider>
  );
}
