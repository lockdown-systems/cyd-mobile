import type { HeadersMap } from "@atproto/xrpc";

import type { JobEmit } from "./job-types";
import type { BlueskyProgress, RateLimitInfo, ResponseHeaders } from "./types";

export type ApiRequestFn<T> = () => Promise<{
  data: T;
  headers?: Headers | HeadersMap;
}>;

interface RateLimiterDeps {
  onProgressUpdate: (updates: Partial<BlueskyProgress>) => void;
  getSessionExpiredCallback: () => (() => Promise<void>) | undefined;
  notifyRateLimit?: (info: RateLimitInfo) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

export class BlueskyRateLimiter {
  private rateLimitInfo: RateLimitInfo = {
    limit: 3000,
    remaining: 3000,
    resetAt: 0,
    isLimited: false,
  };

  private jobEmit: JobEmit | null = null;

  constructor(private deps: RateLimiterDeps) {}

  setJobEmit(emit: JobEmit): void {
    this.jobEmit = emit;
  }

  clearJobEmit(): void {
    this.jobEmit = null;
  }

  setRateLimitCallback(callback?: (info: RateLimitInfo) => void): void {
    this.deps.notifyRateLimit = callback;
  }

  getInfo(): RateLimitInfo {
    return { ...this.rateLimitInfo };
  }

  async makeApiRequest<T>(requestFn: ApiRequestFn<T>): Promise<T> {
    if (this.rateLimitInfo.isLimited) {
      await this.handleRateLimit();
    }

    try {
      const response = await this.makeAuthenticatedRequest(requestFn);
      this.updateRateLimitFromHeaders(response.headers);
      return response.data;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        await this.handleRateLimit(error);
        return this.makeApiRequest(requestFn);
      }
      throw error;
    }
  }

  private async makeAuthenticatedRequest<T>(
    requestFn: ApiRequestFn<T>,
  ): Promise<{ data: T; headers?: ResponseHeaders }> {
    try {
      return await requestFn();
    } catch (error) {
      if (this.isSessionExpiredError(error)) {
        this.deps.onProgressUpdate({
          currentAction: "Waiting for re-authentication...",
          isRunning: false,
        });

        const callback = this.deps.getSessionExpiredCallback();
        if (callback) {
          await callback();
          return this.makeAuthenticatedRequest(requestFn);
        }

        throw new Error("Session expired and no callback provided");
      }

      throw error;
    }
  }

  private updateRateLimitFromHeaders(headers: ResponseHeaders): void {
    const limit = this.getHeaderValue(headers, "ratelimit-limit");
    const remaining = this.getHeaderValue(headers, "ratelimit-remaining");
    const reset = this.getHeaderValue(headers, "ratelimit-reset");

    if (limit) this.rateLimitInfo.limit = parseInt(limit, 10);
    if (remaining) this.rateLimitInfo.remaining = parseInt(remaining, 10);
    if (reset) this.rateLimitInfo.resetAt = parseInt(reset, 10);

    if (limit || remaining || reset) {
      this.notifyRateLimit();
    }
  }

  private getHeaderValue(headers: ResponseHeaders, key: string): string | null {
    if (!headers) {
      return null;
    }

    if (headers instanceof Headers) {
      return headers.get(key);
    }

    const normalizedKey = key.toLowerCase();
    const value = headers[key] ?? headers[normalizedKey];
    return value ?? null;
  }

  private isSessionExpiredError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const err = error as { status?: number; error?: string; message?: string };

    return (
      err.status === 401 ||
      err.error === "ExpiredToken" ||
      err.error === "InvalidToken" ||
      (typeof err.message === "string" &&
        (err.message.includes("token") || err.message.includes("expired")))
    );
  }

  private isRateLimitError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const err = error as { status?: number };
    return err.status === 429;
  }

  private async handleRateLimit(error?: unknown): Promise<void> {
    let resetAt = this.rateLimitInfo.resetAt;

    if (error && typeof error === "object") {
      const err = error as { headers?: Headers | HeadersMap };
      const reset = this.getHeaderValue(err.headers, "ratelimit-reset");
      if (reset) {
        resetAt = parseInt(reset, 10);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    if (!resetAt || resetAt < now) {
      resetAt = now + 300;
    }

    this.rateLimitInfo.isLimited = true;
    this.rateLimitInfo.resetAt = resetAt;
    this.notifyRateLimit();

    this.emitRateLimitStatus(resetAt - now, true);

    await this.waitForRateLimitReset(resetAt);

    this.rateLimitInfo.isLimited = false;
    this.notifyRateLimit();
    this.deps.onProgressUpdate({ currentAction: "Resuming..." });
  }

  private waitForRateLimitReset(resetAt: number): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const remaining = resetAt - now;

        if (remaining <= 0) {
          clearInterval(checkInterval);
          resolve();
        } else {
          this.deps.onProgressUpdate({
            currentAction: `Rate limited. Resuming in ${remaining}s...`,
          });
          this.emitRateLimitStatus(remaining);
          this.notifyRateLimit();
        }
      }, 1000);
    });
  }

  private emitRateLimitStatus(
    remainingSeconds: number,
    clearPreview = false,
  ): void {
    if (!this.jobEmit) return;
    const update: Parameters<JobEmit>[0] = {
      speechText: `Bluesky rate limit hit! Taking a short break...\n\n**I'll continue in:**\n**${formatDuration(remainingSeconds)}**`,
      progressMessage: "Waiting for rate limit to expire...",
    };
    if (clearPreview) {
      update.previewData = null;
    }
    this.jobEmit(update);
  }

  private notifyRateLimit(): void {
    if (this.deps.notifyRateLimit) {
      this.deps.notifyRateLimit({ ...this.rateLimitInfo });
    }
  }
}
