/**
 * @fileoverview Tests for CydAPIClient
 */

import CydAPIClient from "../cyd-api-client";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("CydAPIClient", () => {
  const API_URL = "https://api.cyd.social";
  const DASH_URL = "https://dash.cyd.social";
  let client: CydAPIClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new CydAPIClient(API_URL, DASH_URL);
  });

  describe("constructor", () => {
    it("should set apiURL and dashURL", () => {
      expect(client.apiURL).toBe(API_URL);
      expect(client.dashURL).toBe(DASH_URL);
    });
  });

  describe("setCredentials", () => {
    it("should set user email and device token", () => {
      client.setCredentials("test@example.com", "device-token-123");

      expect(client.getUserEmail()).toBe("test@example.com");
      expect(client.getDeviceToken()).toBe("device-token-123");
    });

    it("should allow setting credentials to null", () => {
      client.setCredentials("test@example.com", "device-token-123");
      client.setCredentials(null, null);

      expect(client.getUserEmail()).toBeNull();
      expect(client.getDeviceToken()).toBeNull();
    });
  });

  describe("setUserEmail", () => {
    it("should set the user email", () => {
      client.setUserEmail("user@example.com");
      expect(client.getUserEmail()).toBe("user@example.com");
    });
  });

  describe("setDeviceToken", () => {
    it("should set the device token and attempt to get API token", async () => {
      // Mock getToken to fail (no credentials set up for it yet)
      mockFetch.mockResolvedValueOnce({
        status: 401,
        json: async () => ({ message: "Unauthorized" }),
      });

      await client.setDeviceToken("new-device-token");
      expect(client.getDeviceToken()).toBe("new-device-token");
    });
  });

  describe("authenticate", () => {
    it("should send authentication request and return true on success", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => ({}),
      });

      const result = await client.authenticate({ email: "test@example.com" });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${API_URL}/authenticate`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "test@example.com" }),
        })
      );
    });

    it("should return error on non-200 response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 400,
        json: async () => ({ message: "Bad request" }),
      });

      const result = await client.authenticate({ email: "test@example.com" });

      expect(result).toEqual({
        error: true,
        message: "Failed to authenticate with the server.",
        status: 400,
      });
    });

    it("should return error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await client.authenticate({ email: "test@example.com" });

      expect(result).toEqual({
        error: true,
        message:
          "Failed to authenticate with the server. Maybe the server is down?",
      });
    });
  });

  describe("registerDevice", () => {
    it("should register device and return response on success", async () => {
      const mockResponse = {
        uuid: "device-uuid-123",
        device_token: "device-token-abc",
      };
      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.registerDevice({
        email: "test@example.com",
        verification_code: "123456",
        description: "Test Device",
        device_type: "mobile",
      });

      expect(result).toEqual(mockResponse);
    });

    it("should return error on non-200 response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 401,
        json: async () => ({}),
      });

      const result = await client.registerDevice({
        email: "test@example.com",
        verification_code: "wrong",
        description: "Test Device",
        device_type: "mobile",
      });

      expect(result).toEqual({
        error: true,
        message: "Failed to register device with the server.",
        status: 401,
      });
    });

    it("should return error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await client.registerDevice({
        email: "test@example.com",
        verification_code: "123456",
        description: "Test Device",
        device_type: "mobile",
      });

      expect(result).toEqual({
        error: true,
        message:
          "Failed to register device with the server. Maybe the server is down?",
      });
    });
  });

  describe("getToken", () => {
    it("should get token and return response on success", async () => {
      const mockResponse = {
        api_token: "api-token-xyz",
        device_uuid: "device-uuid-123",
        email: "test@example.com",
      };
      mockFetch.mockResolvedValueOnce({
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getToken({
        email: "test@example.com",
        device_token: "device-token-abc",
      });

      expect(result).toEqual(mockResponse);
      expect(client.getDeviceUUID()).toBe("device-uuid-123");
    });

    it("should return error on non-200 response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 401,
        json: async () => ({}),
      });

      const result = await client.getToken({
        email: "test@example.com",
        device_token: "invalid-token",
      });

      expect(result).toEqual({
        error: true,
        message: "Failed to get token with the server.",
        status: 401,
      });
    });

    it("should return error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await client.getToken({
        email: "test@example.com",
        device_token: "device-token",
      });

      expect(result).toEqual({
        error: true,
        message:
          "Failed to get token with the server. Maybe the server is down?",
      });
    });
  });

  describe("authenticated endpoints", () => {
    beforeEach(() => {
      // Set up valid credentials
      client.setCredentials("test@example.com", "device-token-123");

      // Mock getToken to succeed for authenticated requests
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/token")) {
          return {
            status: 200,
            json: async () => ({
              api_token: "api-token-xyz",
              device_uuid: "device-uuid-123",
              email: "test@example.com",
            }),
          };
        }
        return { status: 200, json: async () => ({}) };
      });
    });

    describe("ping", () => {
      it("should return true on successful ping", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes("/token")) {
            return {
              status: 200,
              json: async () => ({
                api_token: "api-token-xyz",
                device_uuid: "device-uuid-123",
                email: "test@example.com",
              }),
            };
          }
          return { status: 200 };
        });

        const result = await client.ping();
        expect(result).toBe(true);
      });

      it("should return false on failed ping", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes("/token")) {
            return {
              status: 200,
              json: async () => ({
                api_token: "api-token-xyz",
                device_uuid: "device-uuid-123",
                email: "test@example.com",
              }),
            };
          }
          return { status: 401 };
        });

        const result = await client.ping();
        expect(result).toBe(false);
      });

      it("should return false on network error", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes("/token")) {
            return {
              status: 200,
              json: async () => ({
                api_token: "api-token-xyz",
                device_uuid: "device-uuid-123",
                email: "test@example.com",
              }),
            };
          }
          throw new Error("Network error");
        });

        const result = await client.ping();
        expect(result).toBe(false);
      });
    });

    describe("getUserPremium", () => {
      it("should return premium info on success", async () => {
        const premiumResponse = {
          premium_price_cents: 1200,
          premium_business_price_cents: 4900,
          premium_access: true,
          has_individual_subscription: true,
          subscription_cancel_at_period_end: false,
          subscription_current_period_end: "2025-12-31",
          has_business_subscription: false,
          business_organizations: [],
        };

        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes("/token")) {
            return {
              status: 200,
              json: async () => ({
                api_token: "api-token-xyz",
                device_uuid: "device-uuid-123",
                email: "test@example.com",
              }),
            };
          }
          if (url.includes("/user/premium")) {
            return {
              status: 200,
              json: async () => premiumResponse,
            };
          }
          return { status: 200, json: async () => ({}) };
        });

        const result = await client.getUserPremium();
        expect(result).toEqual(premiumResponse);
      });

      it("should return error on failure", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes("/token")) {
            return {
              status: 200,
              json: async () => ({
                api_token: "api-token-xyz",
                device_uuid: "device-uuid-123",
                email: "test@example.com",
              }),
            };
          }
          if (url.includes("/user/premium")) {
            return { status: 500 };
          }
          return { status: 200, json: async () => ({}) };
        });

        const result = await client.getUserPremium();
        expect(result).toEqual({
          error: true,
          message: "Failed to get user premium status.",
          status: 500,
        });
      });
    });

    describe("deleteDevice", () => {
      it("should delete device successfully", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes("/token")) {
            return {
              status: 200,
              json: async () => ({
                api_token: "api-token-xyz",
                device_uuid: "device-uuid-123",
                email: "test@example.com",
              }),
            };
          }
          return { status: 200 };
        });

        const result = await client.deleteDevice({ uuid: "device-uuid-123" });
        expect(result).toBeUndefined();
      });

      it("should return error on failure", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes("/token")) {
            return {
              status: 200,
              json: async () => ({
                api_token: "api-token-xyz",
                device_uuid: "device-uuid-123",
                email: "test@example.com",
              }),
            };
          }
          if (url.includes("/device")) {
            return { status: 404 };
          }
          return { status: 200 };
        });

        const result = await client.deleteDevice({ uuid: "invalid-uuid" });
        expect(result).toEqual({
          error: true,
          message: "Failed to delete device with the server.",
          status: 404,
        });
      });
    });

    describe("getDevices", () => {
      it("should return devices on success", async () => {
        const devices = [
          {
            uuid: "device-1",
            description: "iPhone",
            last_accessed_at: new Date("2024-01-01"),
          },
          {
            uuid: "device-2",
            description: "iPad",
            last_accessed_at: new Date("2024-01-02"),
          },
        ];

        mockFetch.mockImplementation(
          async (url: string, options?: RequestInit) => {
            if (url.includes("/token")) {
              return {
                status: 200,
                json: async () => ({
                  api_token: "api-token-xyz",
                  device_uuid: "device-uuid-123",
                  email: "test@example.com",
                }),
              };
            }
            if (url.includes("/device") && options?.method === "GET") {
              return {
                status: 200,
                json: async () => devices,
              };
            }
            return { status: 200, json: async () => ({}) };
          }
        );

        const result = await client.getDevices();
        expect(result).toEqual({ devices });
      });
    });
  });

  describe("postNewsletter", () => {
    it("should subscribe to newsletter successfully", async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await client.postNewsletter({
        email: "test@example.com",
      });

      expect(result).toBe(true);
    });

    it("should return error on failure", async () => {
      mockFetch.mockResolvedValueOnce({ status: 400 });

      const result = await client.postNewsletter({
        email: "test@example.com",
      });

      expect(result).toEqual({
        error: true,
        message: "Failed to subscribe to newsletter.",
        status: 400,
      });
    });
  });

  describe("getDashboardURL", () => {
    it("should return base dashboard URL when not signed in", () => {
      const url = client.getDashboardURL();
      expect(url).toBe(DASH_URL);
    });

    it("should return native login URL when signed in", () => {
      client.setCredentials("test@example.com", "device-token-123");

      const url = client.getDashboardURL();
      expect(url).toBe(
        `${DASH_URL}/#/native-login/${encodeURIComponent("test@example.com")}/${encodeURIComponent("device-token-123")}/manage`
      );
    });
  });

  describe("token refresh on 401", () => {
    it("should retry request after refreshing token on 401", async () => {
      client.setCredentials("test@example.com", "device-token-123");

      let callCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/token")) {
          return {
            status: 200,
            json: async () => ({
              api_token: "new-api-token",
              device_uuid: "device-uuid-123",
              email: "test@example.com",
            }),
          };
        }
        if (url.includes("/ping")) {
          callCount++;
          // First call fails with 401, second succeeds
          if (callCount === 1) {
            return { status: 401 };
          }
          return { status: 200 };
        }
        return { status: 200 };
      });

      const result = await client.ping();
      expect(result).toBe(true);
    });
  });
});
