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

  it("reuses one controller per account and cleans up on final release", async () => {
    const leaseA = await acquireBlueskyController(1, "uuid-1");
    const leaseB = await acquireBlueskyController(1, "uuid-1");

    expect(mockControllers).toHaveLength(1);
    expect(leaseA.controller).toBe(leaseB.controller);
    expect(mockControllers[0].initDB).toHaveBeenCalledTimes(1);

    await leaseA.release();
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(0);

    await leaseB.release();
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(1);
  });

  it("creates a new controller after previous entry is fully released", async () => {
    const firstLease = await acquireBlueskyController(22, "uuid-22");
    const firstController = firstLease.controller;
    await firstLease.release();

    const secondLease = await acquireBlueskyController(22, "uuid-22");
    const secondController = secondLease.controller;

    expect(mockControllers).toHaveLength(2);
    expect(secondController).not.toBe(firstController);
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(1);

    await secondLease.release();
    expect(mockControllers[1].cleanup).toHaveBeenCalledTimes(1);
  });

  it("releases lease when withBlueskyController callback throws", async () => {
    await expect(
      withBlueskyController(7, "uuid-7", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mockControllers).toHaveLength(1);
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(1);
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
    expect(mockControllers[1].cleanup).toHaveBeenCalledTimes(1);
  });
});
