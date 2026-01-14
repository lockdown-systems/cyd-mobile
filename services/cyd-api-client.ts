// API error response
export type APIErrorResponse = {
  error: boolean;
  message: string;
  status?: number;
};

// API models for POST /authenticate
export type AuthAPIRequest = {
  email: string;
};

// API models for POST /device
export type RegisterDeviceAPIRequest = {
  email: string;
  verification_code: string;
  description: string;
  device_type: string;
};

export type RegisterDeviceAPIResponse = {
  uuid: string;
  device_token: string;
};

// API models for GET /device (an array of these)
export type GetDevicesAPIResponse = {
  uuid: string;
  description: string;
  last_accessed_at: Date;
};

export type GetDevicesAPIResponseArray = {
  devices: GetDevicesAPIResponse[];
};

// API models for POST /token
export type TokenAPIRequest = {
  email: string;
  device_token: string;
};

export type TokenAPIResponse = {
  api_token: string;
  device_uuid: string;
  email: string;
};

// API models for DELETE /device
export type DeleteDeviceAPIRequest = {
  uuid: string;
};

// API models for GET /user/premium
export type UserPremiumAPIResponse = {
  premium_price_cents: number;
  premium_business_price_cents: number;
  premium_access: boolean;
  has_individual_subscription: boolean;
  subscription_cancel_at_period_end: boolean;
  subscription_current_period_end: string;
  has_business_subscription: boolean;
  business_organizations: string[];
};

// API models for POST /newsletter
export type PostNewsletterAPIRequest = {
  email: string;
};

// API models for POST /bluesky-progress
export type PostBlueskyProgressAPIRequest = {
  account_uuid: string;
  total_posts_saved: number;
  total_reposts_saved: number;
  total_likes_saved: number;
  total_bookmarks_saved: number;
  total_follows_saved: number;
  total_conversations_saved: number;
  total_messages_saved: number;
  total_posts_deleted: number;
  total_reposts_deleted: number;
  total_likes_deleted: number;
  total_bookmarks_deleted: number;
  total_messages_deleted: number;
  total_accounts_unfollowed: number;
};

// API models for POST /push-notification
export type RegisterPushTokenAPIRequest = {
  push_token: string;
  platform: "ios" | "android";
  account_uuid: string;
  account_handle: string;
  timezone: string;
};

// API models for PUT /push-notification/schedule
export type UpdateScheduleSettingsAPIRequest = {
  account_uuid: string;
  schedule_enabled: boolean;
  schedule_frequency: "daily" | "weekly" | "monthly";
  schedule_day_of_month: number;
  schedule_day_of_week: number;
  schedule_time: string; // HH:MM format
};

// API models for DELETE /push-notification
export type UnregisterPushTokenAPIRequest = {
  account_uuid: string;
};

// The API client
export default class CydAPIClient {
  public apiURL: string;
  public dashURL: string;
  private userEmail: string | null = null;
  private deviceToken: string | null = null;
  private apiToken: string | null = null;
  private deviceUUID: string | null = null;

  constructor(apiURL: string, dashURL: string) {
    this.apiURL = apiURL;
    this.dashURL = dashURL;
  }

  setCredentials(userEmail: string | null, deviceToken: string | null): void {
    this.userEmail = userEmail;
    this.deviceToken = deviceToken;
  }

  setUserEmail(userEmail: string): void {
    this.userEmail = userEmail;
  }

  getUserEmail(): string | null {
    return this.userEmail;
  }

  async setDeviceToken(deviceToken: string): Promise<void> {
    this.deviceToken = deviceToken;
    await this.getNewAPIToken();
  }

  getDeviceToken(): string | null {
    return this.deviceToken;
  }

  getDeviceUUID(): string | null {
    return this.deviceUUID;
  }

  private returnError(message: string, status?: number): APIErrorResponse {
    return {
      error: true,
      message: message,
      status: status,
    };
  }

  private async doFetch(
    method: string,
    resource: string,
    body: unknown
  ): Promise<Response> {
    const options: RequestInit = {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
    };
    if (body !== null) {
      options.body = JSON.stringify(body);
    }
    return fetch(resource, options);
  }

  private async fetchAuthenticated(
    method: string,
    resource: string,
    body: unknown
  ): Promise<Response> {
    const options: RequestInit = {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiToken,
      },
    };
    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(resource, options);

    if (response.status !== 401) {
      return response;
    }

    // Try to get a new token, and then try one more time
    console.log(
      "Failed to authenticate with the server. Trying to get a new API token."
    );

    const success = await this.getNewAPIToken();
    if (success) {
      console.log("Got a new API token. Retrying the request.");
      // Update options with new token
      const retryOptions: RequestInit = {
        method: method,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.apiToken,
        },
      };
      if (body !== null) {
        retryOptions.body = JSON.stringify(body);
      }
      return fetch(resource, retryOptions);
    }

    console.log("Failed to get a new API token.");
    return new Response(JSON.stringify({ message: "Authentication failed" }), {
      status: 401,
      headers: { "Content-type": "application/json" },
    });
  }

  private async getNewAPIToken(): Promise<boolean> {
    console.log("Getting a new API token");
    if (
      typeof this.userEmail === "string" &&
      this.userEmail !== "" &&
      typeof this.deviceToken === "string" &&
      this.deviceToken !== ""
    ) {
      const getTokenResp = await this.getToken({
        email: this.userEmail,
        device_token: this.deviceToken,
      });
      if ("error" in getTokenResp) {
        console.log("Failed to get a new API token", getTokenResp.message);
        return false;
      }
      this.apiToken = getTokenResp.api_token;
      return true;
    }
    return false;
  }

  private async validateAPIToken(): Promise<boolean> {
    if (typeof this.apiToken === "string") {
      return true;
    }
    return await this.getNewAPIToken();
  }

  // Auth API (not authenticated)

  async authenticate(
    request: AuthAPIRequest
  ): Promise<boolean | APIErrorResponse> {
    console.log("POST /authenticate");
    try {
      const response = await this.doFetch(
        "POST",
        `${this.apiURL}/authenticate`,
        request
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to authenticate with the server.",
          response.status
        );
      }
      return true;
    } catch {
      return this.returnError(
        "Failed to authenticate with the server. Maybe the server is down?"
      );
    }
  }

  async registerDevice(
    request: RegisterDeviceAPIRequest
  ): Promise<RegisterDeviceAPIResponse | APIErrorResponse> {
    console.log("POST /device");
    try {
      const response = await this.doFetch(
        "POST",
        `${this.apiURL}/device`,
        request
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to register device with the server.",
          response.status
        );
      }
      const data = (await response.json()) as RegisterDeviceAPIResponse;
      return data;
    } catch {
      return this.returnError(
        "Failed to register device with the server. Maybe the server is down?"
      );
    }
  }

  async getToken(
    request: TokenAPIRequest
  ): Promise<TokenAPIResponse | APIErrorResponse> {
    console.log("POST /token");
    try {
      const response = await this.doFetch(
        "POST",
        `${this.apiURL}/token`,
        request
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to get token with the server.",
          response.status
        );
      }
      const data = (await response.json()) as TokenAPIResponse;

      this.apiToken = data.api_token;

      // Set the device UUID
      this.deviceUUID = data.device_uuid;
      return data;
    } catch {
      return this.returnError(
        "Failed to get token with the server. Maybe the server is down?"
      );
    }
  }

  // Auth API (authenticated)

  async deleteDevice(
    request: DeleteDeviceAPIRequest
  ): Promise<void | APIErrorResponse> {
    console.log("DELETE /device");
    if (!(await this.validateAPIToken())) {
      return this.returnError("Failed to get a new API token.");
    }
    try {
      const response = await this.fetchAuthenticated(
        "DELETE",
        `${this.apiURL}/device`,
        request
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to delete device with the server.",
          response.status
        );
      }
    } catch {
      return this.returnError(
        "Failed to delete device with the server. Maybe the server is down?"
      );
    }
  }

  async getDevices(): Promise<GetDevicesAPIResponseArray | APIErrorResponse> {
    console.log("GET /device");
    if (!(await this.validateAPIToken())) {
      return this.returnError("Failed to get a new API token.");
    }
    try {
      const response = await this.fetchAuthenticated(
        "GET",
        `${this.apiURL}/device`,
        null
      );
      if (response.status !== 200) {
        return this.returnError("Failed to get devices.", response.status);
      }
      const data = (await response.json()) as GetDevicesAPIResponse[];
      return { devices: data };
    } catch {
      return this.returnError(
        "Failed to get devices. Maybe the server is down?"
      );
    }
  }

  async ping(): Promise<boolean> {
    console.log("GET /ping");
    if (!(await this.validateAPIToken())) {
      console.log("Failed to get a new API token.");
      return false;
    }
    try {
      const response = await this.fetchAuthenticated(
        "GET",
        `${this.apiURL}/ping`,
        null
      );
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // User API (authenticated)

  async getUserPremium(): Promise<UserPremiumAPIResponse | APIErrorResponse> {
    console.log("GET /user/premium");
    if (!(await this.validateAPIToken())) {
      return this.returnError("Failed to get a new API token.");
    }
    try {
      const response = await this.fetchAuthenticated(
        "GET",
        `${this.apiURL}/user/premium`,
        null
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to get user premium status.",
          response.status
        );
      }
      const data = (await response.json()) as UserPremiumAPIResponse;
      return data;
    } catch {
      return this.returnError(
        "Failed to get user premium status. Maybe the server is down?"
      );
    }
  }

  // Subscribe to newsletter

  async postNewsletter(
    request: PostNewsletterAPIRequest
  ): Promise<boolean | APIErrorResponse> {
    console.log("POST /newsletter");
    try {
      const response = await this.doFetch(
        "POST",
        `${this.apiURL}/newsletter`,
        request
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to subscribe to newsletter.",
          response.status
        );
      }
      return true;
    } catch {
      return this.returnError(
        "Failed to subscribe to newsletter. Maybe the server is down?"
      );
    }
  }

  // User activity

  async postUserActivity(): Promise<boolean | APIErrorResponse> {
    if (!(await this.validateAPIToken())) {
      return this.returnError("Failed to get a new API token.");
    }

    try {
      const response = await this.fetchAuthenticated(
        "POST",
        `${this.apiURL}/user/activity`,
        null
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to update user activity.",
          response.status
        );
      }
      return true;
    } catch {
      return this.returnError(
        "Failed to update user activity. Maybe the server is down?"
      );
    }
  }

  // Get the dashboard URL for managing account
  getDashboardURL(): string {
    if (this.userEmail && this.deviceToken) {
      return `${this.dashURL}/#/native-login/${encodeURIComponent(this.userEmail)}/${encodeURIComponent(this.deviceToken)}/manage`;
    }
    return this.dashURL;
  }

  // Submit Bluesky progress

  async postBlueskyProgress(
    request: PostBlueskyProgressAPIRequest
  ): Promise<boolean | APIErrorResponse> {
    console.log("POST /bluesky-progress");
    if (!(await this.validateAPIToken())) {
      // Try without authentication if we can't get a token
      try {
        const response = await this.doFetch(
          "POST",
          `${this.apiURL}/bluesky-progress`,
          request
        );
        if (response.status !== 200) {
          return this.returnError(
            "Failed to submit Bluesky progress.",
            response.status
          );
        }
        return true;
      } catch {
        return this.returnError(
          "Failed to submit Bluesky progress. Maybe the server is down?"
        );
      }
    }

    try {
      const response = await this.fetchAuthenticated(
        "POST",
        `${this.apiURL}/bluesky-progress`,
        request
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to submit Bluesky progress.",
          response.status
        );
      }
      return true;
    } catch {
      return this.returnError(
        "Failed to submit Bluesky progress. Maybe the server is down?"
      );
    }
  }

  // ==================== Push Notification API ====================

  /**
   * Register a push notification token with the server
   */
  async registerPushToken(
    request: RegisterPushTokenAPIRequest
  ): Promise<true | APIErrorResponse> {
    try {
      const response = await this.fetchAuthenticated(
        "POST",
        `${this.apiURL}/push-notification`,
        request
      );
      if (response.status !== 200 && response.status !== 201) {
        return this.returnError(
          "Failed to register push token.",
          response.status
        );
      }
      return true;
    } catch {
      return this.returnError(
        "Failed to register push token. Maybe the server is down?"
      );
    }
  }

  /**
   * Update schedule settings on the server
   */
  async updateScheduleSettings(
    request: UpdateScheduleSettingsAPIRequest
  ): Promise<true | APIErrorResponse> {
    try {
      const response = await this.fetchAuthenticated(
        "PUT",
        `${this.apiURL}/push-notification/schedule`,
        request
      );
      if (response.status !== 200) {
        return this.returnError(
          "Failed to update schedule settings.",
          response.status
        );
      }
      return true;
    } catch {
      return this.returnError(
        "Failed to update schedule settings. Maybe the server is down?"
      );
    }
  }

  /**
   * Unregister push notifications for an account
   */
  async unregisterPushToken(
    request: UnregisterPushTokenAPIRequest
  ): Promise<true | APIErrorResponse> {
    try {
      const response = await this.fetchAuthenticated(
        "DELETE",
        `${this.apiURL}/push-notification`,
        request
      );
      if (response.status !== 200 && response.status !== 204) {
        return this.returnError(
          "Failed to unregister push token.",
          response.status
        );
      }
      return true;
    } catch {
      return this.returnError(
        "Failed to unregister push token. Maybe the server is down?"
      );
    }
  }
}
