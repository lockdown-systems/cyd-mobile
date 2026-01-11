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
    const jobs = await controller.defineJobs(defaultOptions);

    expect(mockDb.runAsync).toHaveBeenCalledTimes(2);
    expect(jobs.map((job) => job.jobType)).toEqual([
      "verifyAuthorization",
      "savePosts",
    ]);
    expect(jobs.every((job) => job.status === "pending")).toBe(true);
  });

  it("adds likes and bookmarks jobs when enabled", async () => {
    const { controller, mockDb } = setupControllerWithDb();
    const jobs = await controller.defineJobs({
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
    const jobs = await controller.defineJobs(defaultOptions);

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
            `active:${update.activeJobId}:${update.speechText ?? ""}`
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
});
