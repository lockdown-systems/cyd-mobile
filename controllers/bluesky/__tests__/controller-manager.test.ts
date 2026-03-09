import {
  deleteBlueskyAccountStorage,
  disposeAllBlueskyControllersForTests,
  disposeBlueskyController,
  getBlueskyController,
  withBlueskyController,
} from "../controller-manager";

type MockController = {
  initDB: jest.Mock<Promise<void>, []>;
  cleanup: jest.Mock<Promise<void>, []>;
  deleteAccountStorage: jest.Mock<Promise<void>, []>;
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
          deleteAccountStorage: jest.fn(async () => undefined),
        };
        mockControllers.push(controller);
        return controller;
      }),
  };
});

describe("bluesky controller manager", () => {
  beforeEach(async () => {
    await disposeAllBlueskyControllersForTests();
    mockControllers.length = 0;
    jest.clearAllMocks();
  });

  it("reuses one controller per account", async () => {
    const controllerA = await getBlueskyController(1, "uuid-1");
    const controllerB = await getBlueskyController(1, "uuid-1");

    expect(mockControllers).toHaveLength(1);
    expect(controllerA).toBe(controllerB);
    expect(mockControllers[0].initDB).toHaveBeenCalledTimes(1);
  });

  it("initializes once when called concurrently", async () => {
    const [controllerA, controllerB, controllerC] = await Promise.all([
      getBlueskyController(5, "uuid-5"),
      getBlueskyController(5, "uuid-5"),
      getBlueskyController(5, "uuid-5"),
    ]);

    expect(mockControllers).toHaveLength(1);
    expect(controllerA).toBe(controllerB);
    expect(controllerB).toBe(controllerC);
    expect(mockControllers[0].initDB).toHaveBeenCalledTimes(1);
  });

  it("does not clean up after withBlueskyController callback", async () => {
    const result = await withBlueskyController(10, "uuid-10", async () => {
      return "ok";
    });

    expect(result).toBe("ok");
    expect(mockControllers).toHaveLength(1);
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(0);
  });

  it("reuses singleton across get and with helper", async () => {
    const controllerFromGet = await getBlueskyController(11, "uuid-11");
    const controllerFromWith = await withBlueskyController(
      11,
      "uuid-11",
      async (controller) => controller,
    );

    expect(mockControllers).toHaveLength(1);
    expect(controllerFromWith).toBe(controllerFromGet);
    expect(mockControllers[0].initDB).toHaveBeenCalledTimes(1);
  });

  it("disposes and recreates controller on next get", async () => {
    const first = await getBlueskyController(22, "uuid-22");
    await disposeBlueskyController(22);

    expect(mockControllers).toHaveLength(1);
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(1);

    const second = await getBlueskyController(22, "uuid-22");

    expect(mockControllers).toHaveLength(2);
    expect(second).not.toBe(first);
  });

  it("cleans up failed initialization and allows retry", async () => {
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
        deleteAccountStorage: jest.fn(async () => undefined),
      };
      mockControllers.push(controller);
      return controller;
    });

    await expect(getBlueskyController(99, "uuid-99")).rejects.toThrow(
      "init failed",
    );
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(1);

    const retryController = await getBlueskyController(99, "uuid-99");
    expect(mockControllers).toHaveLength(2);
    expect(retryController).toBeDefined();
  });

  it("disposes managed controller before deleting account storage", async () => {
    await getBlueskyController(42, "uuid-42");

    await deleteBlueskyAccountStorage(42, "uuid-42");

    expect(mockControllers).toHaveLength(2);
    expect(mockControllers[0].cleanup).toHaveBeenCalledTimes(1);
    expect(mockControllers[1].deleteAccountStorage).toHaveBeenCalledTimes(1);
  });
});
