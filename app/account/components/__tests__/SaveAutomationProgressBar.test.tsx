/**
 * @fileoverview Tests for SaveAutomationProgressBar component
 */

import React from "react";

import type { BlueskyJobRecord } from "@/controllers/bluesky/job-types";
import type { AccountTabPalette } from "@/types/account-tabs";

import { SaveAutomationProgressBar } from "../SaveAutomationProgressBar";

const mockPalette: AccountTabPalette = {
  background: "#ffffff",
  text: "#000000",
  tint: "#0066cc",
  icon: "#666666",
  tabIconDefault: "#666666",
  tabIconSelected: "#0066cc",
  card: "#f5f5f5",
  button: {
    background: "#0066cc",
    text: "#ffffff",
    ripple: "rgba(255, 255, 255, 0.2)",
  },
  danger: "#ff0000",
  warning: "#ff9900",
};

function createJob(
  id: number,
  jobType: BlueskyJobRecord["jobType"],
  status: BlueskyJobRecord["status"]
): BlueskyJobRecord {
  return {
    id,
    jobType,
    status,
    scheduledAt: Date.now(),
    startedAt: status !== "pending" ? Date.now() : null,
    finishedAt:
      status === "completed" || status === "failed" ? Date.now() : null,
  };
}

describe("SaveAutomationProgressBar", () => {
  describe("exports", () => {
    it("should export SaveAutomationProgressBar component", () => {
      expect(SaveAutomationProgressBar).toBeDefined();
      expect(typeof SaveAutomationProgressBar).toBe("function");
    });
  });

  describe("component creation", () => {
    it("should render without jobs", () => {
      const element = React.createElement(SaveAutomationProgressBar, {
        jobs: [],
        activeJobProgress: 0,
        activeJobUnknownTotal: false,
        palette: mockPalette,
      });
      expect(element).toBeDefined();
      expect(element.props.jobs).toEqual([]);
    });

    it("should accept jobs prop", () => {
      const jobs: BlueskyJobRecord[] = [
        createJob(1, "verifyAuthorization", "completed"),
        createJob(2, "savePosts", "running"),
      ];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0.5,
        activeJobUnknownTotal: true,
        palette: mockPalette,
      });

      expect(element.props.jobs).toBe(jobs);
      expect(element.props.jobs.length).toBe(2);
    });

    it("should accept activeJobProgress prop", () => {
      const element = React.createElement(SaveAutomationProgressBar, {
        jobs: [],
        activeJobProgress: 0.75,
        activeJobUnknownTotal: false,
        palette: mockPalette,
      });

      expect(element.props.activeJobProgress).toBe(0.75);
    });

    it("should accept activeJobUnknownTotal prop for indeterminate progress", () => {
      const element = React.createElement(SaveAutomationProgressBar, {
        jobs: [],
        activeJobProgress: 0,
        activeJobUnknownTotal: true,
        palette: mockPalette,
      });

      expect(element.props.activeJobUnknownTotal).toBe(true);
    });

    it("should accept palette prop", () => {
      const element = React.createElement(SaveAutomationProgressBar, {
        jobs: [],
        activeJobProgress: 0,
        activeJobUnknownTotal: false,
        palette: mockPalette,
      });

      expect(element.props.palette).toBe(mockPalette);
    });
  });

  describe("job configuration", () => {
    it("should handle verifyAuthorization job", () => {
      const jobs: BlueskyJobRecord[] = [
        createJob(1, "verifyAuthorization", "running"),
      ];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0,
        activeJobUnknownTotal: false,
        palette: mockPalette,
      });

      expect(element.props.jobs[0].jobType).toBe("verifyAuthorization");
    });

    it("should handle savePosts job", () => {
      const jobs: BlueskyJobRecord[] = [createJob(1, "savePosts", "running")];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0.5,
        activeJobUnknownTotal: true,
        palette: mockPalette,
      });

      expect(element.props.jobs[0].jobType).toBe("savePosts");
    });

    it("should handle saveLikes job", () => {
      const jobs: BlueskyJobRecord[] = [createJob(1, "saveLikes", "running")];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0.3,
        activeJobUnknownTotal: true,
        palette: mockPalette,
      });

      expect(element.props.jobs[0].jobType).toBe("saveLikes");
    });

    it("should handle saveBookmarks job", () => {
      const jobs: BlueskyJobRecord[] = [
        createJob(1, "saveBookmarks", "running"),
      ];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0.8,
        activeJobUnknownTotal: true,
        palette: mockPalette,
      });

      expect(element.props.jobs[0].jobType).toBe("saveBookmarks");
    });

    it("should handle multiple jobs in sequence", () => {
      const jobs: BlueskyJobRecord[] = [
        createJob(1, "verifyAuthorization", "completed"),
        createJob(2, "savePosts", "completed"),
        createJob(3, "saveLikes", "running"),
        createJob(4, "saveBookmarks", "pending"),
      ];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0.5,
        activeJobUnknownTotal: true,
        palette: mockPalette,
      });

      expect(element.props.jobs.length).toBe(4);
      expect(element.props.jobs[0].status).toBe("completed");
      expect(element.props.jobs[1].status).toBe("completed");
      expect(element.props.jobs[2].status).toBe("running");
      expect(element.props.jobs[3].status).toBe("pending");
    });
  });

  describe("job status handling", () => {
    it("should handle pending status", () => {
      const jobs: BlueskyJobRecord[] = [createJob(1, "savePosts", "pending")];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0,
        activeJobUnknownTotal: false,
        palette: mockPalette,
      });

      expect(element.props.jobs[0].status).toBe("pending");
      expect(element.props.jobs[0].startedAt).toBeNull();
    });

    it("should handle running status", () => {
      const jobs: BlueskyJobRecord[] = [createJob(1, "savePosts", "running")];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0.5,
        activeJobUnknownTotal: true,
        palette: mockPalette,
      });

      expect(element.props.jobs[0].status).toBe("running");
      expect(element.props.jobs[0].startedAt).not.toBeNull();
    });

    it("should handle completed status", () => {
      const jobs: BlueskyJobRecord[] = [createJob(1, "savePosts", "completed")];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 1,
        activeJobUnknownTotal: false,
        palette: mockPalette,
      });

      expect(element.props.jobs[0].status).toBe("completed");
      expect(element.props.jobs[0].finishedAt).not.toBeNull();
    });

    it("should handle failed status", () => {
      const jobs: BlueskyJobRecord[] = [createJob(1, "savePosts", "failed")];

      const element = React.createElement(SaveAutomationProgressBar, {
        jobs,
        activeJobProgress: 0,
        activeJobUnknownTotal: false,
        palette: mockPalette,
      });

      expect(element.props.jobs[0].status).toBe("failed");
      expect(element.props.jobs[0].finishedAt).not.toBeNull();
    });
  });
});
