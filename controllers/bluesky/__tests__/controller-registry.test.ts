import {
  acquireBlueskyController,
  resetBlueskyControllerRegistryForTests,
  withBlueskyController,
} from "../controller-registry";

type MockController = {
  initDB: jest.Mock<Promise<void>, []>;
  cleanup: jest.Mock<Promise<void>, []>;
};

const mockControllers: MockController[] = [];

jest.mock("@/controllers/BlueskyAccountController", () => {
  return {
    BlueskyAccountController: jest
      .fn()
      .mockImplementation((): MockController => {
        const controller: MockController = {
          initDB: jest.fn(async () => undefined),
          cleanup: jest.fn(async () => undefined),
        };
        mockControllers.push(controller);
        return controller;
      }),
  };
});

describe("bluesky controller registry", () => {
  beforeEach(async () => {
    await resetBlueskyControllerRegistryForTests();
    mockControllers.length = 0;
    jest.clearAllMocks();
  });

  it("reuses one controller per account via compatibility lease", async () => {
    const leaseA = await acquireBlueskyController(1, "uuid-1");
    const leaseB = await acquireBlueskyController(1, "uuid-1");

    expect(mockControllers).toHaveLength(1);
    expect(leaseA.controller).toBe(leaseB.controller);
    expect(mockControllers[0].initDB).toHaveBeenCalledTimes(1);

    await leaseA.release();
    await leaseB.release();
    // Legacy release is now a no-op; cleanup is explicit manager disposal.
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(0);
  });

  it("passes through holdWhile for compatibility", async () => {
    const lease = await acquireBlueskyController(5, "uuid-5");

    let resolveHold: (() => void) | null = null;
    const holdPromise = new Promise<void>((resolve) => {
      resolveHold = resolve;
    });

    const held = lease.holdWhile(holdPromise);
    await lease.release();

    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(0);

    if (resolveHold) {
      resolveHold();
    }
    await held;

    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(0);
  });

  it("keeps controller alive after release for manager lifecycle", async () => {
    const firstLease = await acquireBlueskyController(22, "uuid-22");
    const firstController = firstLease.controller;
    await firstLease.release();

    const secondLease = await acquireBlueskyController(22, "uuid-22");
    const secondController = secondLease.controller;

    expect(mockControllers).toHaveLength(1);
    expect(secondController).toBe(firstController);
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(0);

    await secondLease.release();
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(0);
  });

  it("preserves callback error behavior in withBlueskyController", async () => {
    await expect(
      withBlueskyController(7, "uuid-7", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mockControllers).toHaveLength(1);
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(0);
  });

  it("cleans up failed initialization entry and allows retry", async () => {
    const initDbImpl = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("init failed"))
      .mockResolvedValue(undefined);

    const mockedClass = jest.mocked(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/controllers/BlueskyAccountController") as {
        BlueskyAccountController: jest.Mock;
      },
    ).BlueskyAccountController;

    mockedClass.mockImplementation((): MockController => {
      const controller: MockController = {
        initDB: jest.fn(() => initDbImpl()),
        cleanup: jest.fn(async () => undefined),
      };
      mockControllers.push(controller);
      return controller;
    });

    await expect(acquireBlueskyController(99, "uuid-99")).rejects.toThrow(
      "init failed",
    );
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(1);

    const retryLease = await acquireBlueskyController(99, "uuid-99");
    expect(mockControllers).toHaveLength(2);
    await retryLease.release();
    expect(mockControllers[1].cleanup).toHaveBeenCalledTimes(0);
  });
});
