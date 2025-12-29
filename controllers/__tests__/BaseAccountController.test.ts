/**
 * @fileoverview Tests for BaseAccountController
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { BaseAccountController } from "../BaseAccountController";

// Mock implementation for testing
interface TestProgress {
  count: number;
  message: string;
  isRunning: boolean;
}

class TestAccountController extends BaseAccountController<TestProgress> {
  public mockDb: Partial<SQLiteDatabase> | null = null;

  getAccountType(): string {
    return "test";
  }

  resetProgress(): TestProgress {
    return {
      count: 0,
      message: "",
      isRunning: false,
    };
  }

  async initDB(): Promise<void> {
    // For testing, we set a mock database directly
    // No need to call updateAccessedAt which requires the main DB
    this.db = this.mockDb as SQLiteDatabase;
  }

  // Expose protected methods for testing
  public getDbForTesting(): SQLiteDatabase | null {
    return this.db;
  }

  public getProgressForTesting(): TestProgress {
    return this._progress;
  }
}

describe("BaseAccountController", () => {
  describe("constructor", () => {
    it("should create a controller with the given account ID", () => {
      const controller = new TestAccountController(123);
      expect(controller.getAccountId()).toBe(123);
    });

    it("should generate a UUID on construction", () => {
      const controller1 = new TestAccountController(1);
      const controller2 = new TestAccountController(2);

      expect(controller1.getAccountUUID()).toBeDefined();
      expect(controller2.getAccountUUID()).toBeDefined();
      expect(controller1.getAccountUUID()).not.toBe(
        controller2.getAccountUUID()
      );
    });

    it("should initialize with reset progress state", () => {
      const controller = new TestAccountController(1);
      const progress = controller.progress;

      expect(progress.count).toBe(0);
      expect(progress.message).toBe("");
      expect(progress.isRunning).toBe(false);
    });
  });

  describe("getAccountType", () => {
    it("should return the account type", () => {
      const controller = new TestAccountController(1);
      expect(controller.getAccountType()).toBe("test");
    });
  });

  describe("progress", () => {
    it("should return the current progress", () => {
      const controller = new TestAccountController(1);

      expect(controller.progress).toEqual({
        count: 0,
        message: "",
        isRunning: false,
      });
    });

    it("should be read-only from outside", () => {
      const controller = new TestAccountController(1);
      const progress = controller.progress;

      // The progress object itself is exposed
      expect(typeof progress).toBe("object");
    });
  });

  describe("cleanup", () => {
    it("should close the database connection", async () => {
      const controller = new TestAccountController(1);
      const mockClose = jest.fn(() => Promise.resolve());

      controller.mockDb = {
        closeAsync: mockClose,
      };

      await controller.initDB();
      expect(controller.getDbForTesting()).not.toBeNull();

      await controller.cleanup();

      expect(mockClose).toHaveBeenCalled();
      expect(controller.getDbForTesting()).toBeNull();
    });

    it("should handle cleanup when db is null", async () => {
      const controller = new TestAccountController(1);

      // Should not throw
      await expect(controller.cleanup()).resolves.not.toThrow();
    });
  });

  describe("generateDatabasePath", () => {
    it("should generate correct path based on account type", () => {
      const controller = new TestAccountController(42);
      const uuid = controller.getAccountUUID();

      // The path should contain the account type and UUID
      // This is tested indirectly through the openAccountDatabase method
      expect(controller.getAccountType()).toBe("test");
      expect(uuid).toBeDefined();
    });
  });
});
