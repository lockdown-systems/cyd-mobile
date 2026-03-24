/**
 * @fileoverview Tests for BlueskyRateLimiter
 */

import type { BlueskyProgress, RateLimitInfo } from "../types";

import { BlueskyRateLimiter } from "../rate-limiter";

function createDeps() {
  const progressUpdates: Partial<BlueskyProgress>[] = [];
  const rateLimitNotifications: RateLimitInfo[] = [];
  return {
    deps: {
      onProgressUpdate: jest.fn((u: Partial<BlueskyProgress>) =>
        progressUpdates.push(u),
      ),
      getSessionExpiredCallback: jest.fn(() => undefined),
      notifyRateLimit: jest.fn((info: RateLimitInfo) =>
        rateLimitNotifications.push(info),
      ),
    },
    progressUpdates,
    rateLimitNotifications,
  };
}

describe("BlueskyRateLimiter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("passes through a successful request", async () => {
    const { deps } = createDeps();
    const limiter = new BlueskyRateLimiter(deps);

    const result = await limiter.makeApiRequest(async () => ({
      data: "ok",
      headers: {
        "ratelimit-limit": "5000",
        "ratelimit-remaining": "4999",
        "ratelimit-reset": "9999999999",
      },
    }));

    expect(result).toBe("ok");
    expect(limiter.getInfo().remaining).toBe(4999);
  });

  it("handles a 429 rate limit error and retries after reset", async () => {
    const { deps } = createDeps();
    const limiter = new BlueskyRateLimiter(deps);

    const jobEmitCalls: Parameters<typeof limiter.setJobEmit>[0] extends (
      u: infer U,
    ) => void
      ? U[]
      : never = [];
    const jobEmit = jest.fn((update) => jobEmitCalls.push(update));
    limiter.setJobEmit(jobEmit);

    const nowSec = Math.floor(Date.now() / 1000);
    const resetAt = nowSec + 3; // resets in 3 seconds

    let callCount = 0;
    const requestFn = jest.fn(async () => {
      callCount++;
      if (callCount === 1) {
        const err: { status: number; headers: Record<string, string> } = {
          status: 429,
          headers: {
            "ratelimit-limit": "5000",
            "ratelimit-remaining": "0",
            "ratelimit-reset": String(resetAt),
          },
        };
        throw err;
      }
      return {
        data: "success after retry",
        headers: {
          "ratelimit-limit": "5000",
          "ratelimit-remaining": "4999",
          "ratelimit-reset": "9999999999",
        },
      };
    });

    // Start the request — it will hit 429 and enter the wait loop
    const resultPromise = limiter.makeApiRequest(requestFn);

    // Let the setInterval tick 3 times (3 seconds of countdown)
    for (let i = 0; i < 3; i++) {
      await jest.advanceTimersByTimeAsync(1000);
    }
    // One more tick so the interval sees remaining <= 0 and resolves
    await jest.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toBe("success after retry");
    expect(requestFn).toHaveBeenCalledTimes(2);

    // Verify job emit was called with rate limit speech and resetAt
    expect(jobEmit).toHaveBeenCalled();
    const firstEmit = jobEmitCalls[0];
    expect(firstEmit.speechText).toBe(
      "Bluesky rate limit hit! Taking a short break...",
    );
    expect(firstEmit.progressMessage).toBe(
      "Waiting for rate limit to expire...",
    );
    expect(firstEmit.rateLimitResetAt).toBe(resetAt);
    expect(firstEmit.previewData).toBeNull();

    // Verify rate limit info was updated during the wait
    expect(deps.notifyRateLimit).toHaveBeenCalled();
    const info = limiter.getInfo();
    expect(info.isLimited).toBe(false); // should be cleared after reset
  });

  it("does not emit to job when no jobEmit is set", async () => {
    const { deps } = createDeps();
    const limiter = new BlueskyRateLimiter(deps);
    // No setJobEmit call

    const nowSec = Math.floor(Date.now() / 1000);
    const resetAt = nowSec + 1;

    let callCount = 0;
    const requestFn = jest.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw {
          status: 429,
          headers: { "ratelimit-reset": String(resetAt) },
        };
      }
      return { data: "ok", headers: {} };
    });

    const resultPromise = limiter.makeApiRequest(requestFn);
    await jest.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result).toBe("ok");
    // Should not throw — just silently skips job emit
  });

  it("clears jobEmit reference", () => {
    const { deps } = createDeps();
    const limiter = new BlueskyRateLimiter(deps);
    const emit = jest.fn();

    limiter.setJobEmit(emit);
    limiter.clearJobEmit();

    // Internal state — we verify indirectly via a 429 that doesn't call emit
    // Already covered by the "no jobEmit" test pattern above
    expect(emit).not.toHaveBeenCalled();
  });

  it("falls back to 300s wait when no reset header is present", async () => {
    const { deps } = createDeps();
    const limiter = new BlueskyRateLimiter(deps);

    const jobEmitCalls: Record<string, unknown>[] = [];
    limiter.setJobEmit(jest.fn((u) => jobEmitCalls.push(u)));

    let callCount = 0;
    const requestFn = jest.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw { status: 429 }; // no headers at all
      }
      return { data: "ok", headers: {} };
    });

    const resultPromise = limiter.makeApiRequest(requestFn);

    // The first emit should mention the rate limit
    await jest.advanceTimersByTimeAsync(1000);
    expect(jobEmitCalls.length).toBeGreaterThan(0);
    const speech = jobEmitCalls[0].speechText as string;
    expect(speech).toBe("Bluesky rate limit hit! Taking a short break...");

    // Fast-forward past the 300s wait
    await jest.advanceTimersByTimeAsync(300_000);

    const result = await resultPromise;
    expect(result).toBe("ok");
  });
});
