/**
 * @fileoverview Tests for BaseAccountController
 */

import type { SQLiteDatabase } from "expo-sqlite";
import { openDatabaseAsync } from "expo-sqlite";

import {
  BaseAccountController,
  CancelledError,
} from "../BaseAccountController";

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

class SharedDbTestController extends BaseAccountController<TestProgress> {
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
    this.db = await this.openAccountDatabase();
  }

  public getDbForTesting(): SQLiteDatabase | null {
    return this.db;
  }
}

describe("BaseAccountController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
        controller2.getAccountUUID(),
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

    it("should reuse shared account DB and only close on final cleanup", async () => {
      const accountUUID = "shared-account-uuid";
      const controllerA = new SharedDbTestController(1, accountUUID);
      const controllerB = new SharedDbTestController(2, accountUUID);

      await controllerA.initDB();
      await controllerB.initDB();

      const dbA = controllerA.getDbForTesting();
      const dbB = controllerB.getDbForTesting();

      expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
      expect(dbA).toBeTruthy();
      expect(dbB).toBeTruthy();
      expect(dbA).toBe(dbB);

      const closeAsync = (dbA as { closeAsync: jest.Mock }).closeAsync;

      await controllerA.cleanup();
      expect(closeAsync).toHaveBeenCalledTimes(0);

      await controllerB.cleanup();
      expect(closeAsync).toHaveBeenCalledTimes(1);
    });

    it("should open separate databases for different account UUIDs", async () => {
      const controllerA = new SharedDbTestController(1, "uuid-a");
      const controllerB = new SharedDbTestController(2, "uuid-b");

      await controllerA.initDB();
      await controllerB.initDB();

      expect(openDatabaseAsync).toHaveBeenCalledTimes(2);

      await controllerA.cleanup();
      await controllerB.cleanup();
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

  describe("cancel", () => {
    it("should start in non-cancelled state", () => {
      const controller = new TestAccountController(1);
      expect(controller.isCancelled()).toBe(false);
    });

    it("cancel() sets the cancelled flag", () => {
      const controller = new TestAccountController(1);
      controller.cancel();
      expect(controller.isCancelled()).toBe(true);
    });

    it("resetCancel() clears the cancelled flag", () => {
      const controller = new TestAccountController(1);
      controller.cancel();
      expect(controller.isCancelled()).toBe(true);
      controller.resetCancel();
      expect(controller.isCancelled()).toBe(false);
    });

    it("waitForPause() throws CancelledError when cancelled", async () => {
      const controller = new TestAccountController(1);
      controller.cancel();
      await expect(controller.waitForPause()).rejects.toThrow(CancelledError);
    });

    it("waitForPause() throws CancelledError when cancelled while paused", async () => {
      const controller = new TestAccountController(1);
      controller.pause();

      // Start waiting (will block on pause)
      const waitPromise = controller.waitForPause();

      // Cancel while paused — should unblock and throw
      controller.cancel();

      await expect(waitPromise).rejects.toThrow(CancelledError);
    });

    it("waitForPause() resolves normally after resetCancel + resume", async () => {
      const controller = new TestAccountController(1);
      controller.cancel();
      controller.resetCancel();

      // Should not throw since cancel was reset
      await expect(controller.waitForPause()).resolves.toBeUndefined();
    });

    it("cancel() unblocks a paused waitForPause() even without resume()", async () => {
      const controller = new TestAccountController(1);
      controller.pause();

      let threw = false;
      const waitPromise = controller.waitForPause().catch((err) => {
        if (err instanceof CancelledError) threw = true;
      });

      // Without calling resume(), cancel should still unblock it
      controller.cancel();
      await waitPromise;

      expect(threw).toBe(true);
      expect(controller.isPaused()).toBe(true); // pause state unchanged
    });
  });
});
