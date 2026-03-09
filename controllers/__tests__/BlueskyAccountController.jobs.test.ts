import { createMockDatabase } from "@/testUtils/mockDatabase";
import { BlueskyAccountController } from "../BlueskyAccountController";
import type { SaveJobOptions } from "../bluesky/job-types";

jest.mock("@/database", () => ({
  getDatabase: jest.fn(async () => ({
    getFirstAsync: jest.fn(async () => ({
      id: 1,
      uuid: "uuid-1",
      sortOrder: 0,
      type: "bluesky",
      bskyAccountID: 1,
      handle: "tester",
      displayName: null,
      avatarUrl: null,
      did: "did:plc:tester",
    })),
  })),
}));

jest.mock("@/services/bluesky-account-auth-status", () => ({
  verifyBlueskyAccountAuthStatus: jest.fn(async () => "authenticated"),
}));

jest.mock("@/services/bluesky-oauth", () => ({
  authenticateBlueskyAccount: jest.fn(async () => undefined),
}));

describe("BlueskyAccountController job pipeline", () => {
  const defaultOptions: SaveJobOptions = {
    posts: true,
    likes: false,
    bookmarks: false,
    chat: false,
  };

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const setupControllerWithDb = () => {
    const controller = new BlueskyAccountController(1);
    const mockDb = createMockDatabase();
    let idCounter = 0;

    mockDb.runAsync = jest.fn().mockImplementation((sql: string) => {
      if (sql.startsWith("INSERT INTO job")) {
        idCounter += 1;
        return Promise.resolve({ changes: 1, lastInsertRowId: idCounter });
      }
      return Promise.resolve({ changes: 1, lastInsertRowId: idCounter });
    });

    (controller as unknown as { db: typeof mockDb }).db = mockDb as never;
    return { controller, mockDb };
  };

  it("defines jobs for verifyAuthorization and savePosts only", async () => {
    const { controller, mockDb } = setupControllerWithDb();
    const jobs = await controller.defineSaveJobs(defaultOptions);

    expect(mockDb.runAsync).toHaveBeenCalledTimes(2);
    expect(jobs.map((job) => job.jobType)).toEqual([
      "verifyAuthorization",
      "savePosts",
    ]);
    expect(jobs.every((job) => job.status === "pending")).toBe(true);
  });

  it("adds likes and bookmarks jobs when enabled", async () => {
    const { controller, mockDb } = setupControllerWithDb();
    const jobs = await controller.defineSaveJobs({
      ...defaultOptions,
      likes: true,
      bookmarks: true,
    });

    expect(mockDb.runAsync).toHaveBeenCalledTimes(4);
    expect(jobs.map((job) => job.jobType)).toEqual([
      "verifyAuthorization",
      "savePosts",
      "saveLikes",
      "saveBookmarks",
    ]);
  });

  it("runs jobs sequentially and marks completion", async () => {
    const { controller, mockDb } = setupControllerWithDb();
    const jobs = await controller.defineSaveJobs(defaultOptions);

    const initAgent = jest
      .spyOn(controller, "initAgent")
      .mockImplementation(async () => {
        (controller as unknown as { agent: unknown }).agent = {};
      });
    const indexPosts = jest
      .spyOn(controller, "indexPosts")
      .mockResolvedValue(undefined);

    const updates: string[] = [];

    const resumeInterval = setInterval(() => controller.resume(), 5);

    await controller.runJobs({
      jobs,
      onUpdate: (update) => {
        if (update.activeJobId) {
          updates.push(
            `active:${update.activeJobId}:${update.speechText ?? ""}`,
          );
        }
      },
    });

    clearInterval(resumeInterval);

    expect(initAgent).toHaveBeenCalledTimes(1);
    expect(indexPosts).toHaveBeenCalledTimes(1);

    // Two inserts + two status updates per job (running + completed)
    expect(mockDb.runAsync).toHaveBeenCalled();
    expect(updates.length).toBeGreaterThan(0);
  });

  it("runs likes and bookmarks jobs", async () => {
    const { controller, mockDb } = setupControllerWithDb();
    const now = Date.now();
    const jobs = [
      {
        id: 1,
        jobType: "saveLikes" as const,
        status: "pending" as const,
        scheduledAt: now,
        startedAt: null,
        finishedAt: null,
        progress: undefined,
        error: null,
      },
      {
        id: 2,
        jobType: "saveBookmarks" as const,
        status: "pending" as const,
        scheduledAt: now,
        startedAt: null,
        finishedAt: null,
        progress: undefined,
        error: null,
      },
    ];

    (controller as unknown as { agent: unknown }).agent = {};

    const indexLikes = jest
      .spyOn(controller, "indexLikes")
      .mockResolvedValue(undefined);
    const indexBookmarks = jest
      .spyOn(controller, "indexBookmarks")
      .mockResolvedValue(undefined);

    const updates: string[] = [];

    const resumeInterval = setInterval(() => controller.resume(), 5);

    await controller.runJobs({
      jobs,
      onUpdate: (update) => {
        if (update.activeJobId) {
          updates.push(`active:${update.activeJobId}`);
        }
      },
    });

    clearInterval(resumeInterval);

    expect(indexLikes).toHaveBeenCalledTimes(1);
    expect(indexBookmarks).toHaveBeenCalledTimes(1);
    expect(mockDb.runAsync).toHaveBeenCalled();
    expect(updates.length).toBeGreaterThan(0);
  });

  it("keeps in-memory failure states when persisting failed status throws", async () => {
    const { controller, mockDb } = setupControllerWithDb();
    const now = Date.now();
    const jobs = [
      {
        id: 1,
        jobType: "savePosts" as const,
        status: "pending" as const,
        scheduledAt: now,
        startedAt: null,
        finishedAt: null,
        progress: undefined,
        error: null,
      },
      {
        id: 2,
        jobType: "saveLikes" as const,
        status: "pending" as const,
        scheduledAt: now,
        startedAt: null,
        finishedAt: null,
        progress: undefined,
        error: null,
      },
    ];

    (controller as unknown as { agent: unknown }).agent = {};

    jest
      .spyOn(controller, "indexPosts")
      .mockRejectedValue(new Error("save posts failed"));
    const indexLikes = jest
      .spyOn(controller, "indexLikes")
      .mockResolvedValue(undefined);

    mockDb.runAsync = jest
      .fn()
      .mockImplementation((sql: string, params?: unknown[]) => {
        if (
          sql.includes("UPDATE job") &&
          Array.isArray(params) &&
          params[0] === "failed"
        ) {
          return Promise.reject(new Error("database is locked"));
        }
        return Promise.resolve({ changes: 1, lastInsertRowId: 0 });
      });

    let lastUpdateJobs: typeof jobs = jobs;

    await expect(
      controller.runJobs({
        jobs,
        onUpdate: (update) => {
          lastUpdateJobs = update.jobs as typeof jobs;
        },
      }),
    ).resolves.toBeUndefined();

    expect(indexLikes).not.toHaveBeenCalled();
    expect(lastUpdateJobs[0].status).toBe("failed");
    expect(lastUpdateJobs[0].error).toBe("save posts failed");
    expect(lastUpdateJobs[1].status).toBe("failed");
    expect(lastUpdateJobs[1].error).toBe("Cancelled due to previous failure");
  });

  it("rejects overlapping runJobs calls for the same account", async () => {
    const { controller } = setupControllerWithDb();
    const now = Date.now();
    const jobs = [
      {
        id: 1,
        jobType: "savePosts" as const,
        status: "pending" as const,
        scheduledAt: now,
        startedAt: null,
        finishedAt: null,
        progress: undefined,
        error: null,
      },
    ];

    (controller as unknown as { agent: unknown }).agent = {};

    let resolveIndexPosts: (() => void) | null = null;
    const indexPostsPromise = new Promise<void>((resolve) => {
      resolveIndexPosts = resolve;
    });

    jest.spyOn(controller, "indexPosts").mockImplementation(async () => {
      await indexPostsPromise;
    });

    const firstRunPromise = controller.runJobs({ jobs });

    await expect(controller.runJobs({ jobs })).rejects.toThrow(
      "Automation already running for this account.",
    );

    if (resolveIndexPosts) {
      resolveIndexPosts();
    }

    await expect(firstRunPromise).resolves.toBeUndefined();
  });
});
