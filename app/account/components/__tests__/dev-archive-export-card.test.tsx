import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { Colors } from "@/constants/theme";
import type { BlueskyArchiveExportRuntime } from "@/hooks/use-bluesky-archive-export";

import { DevArchiveExportCard } from "../DevArchiveExportCard";

/**
 * Export must not reach people before #100 proves an archive Mobile writes can
 * be read back (ADR 0004). `__DEV__` is the whole of that gate, so it is worth
 * a test that fails loudly if the affordance ever renders in a release build.
 *
 * Everything else here is about the two things somebody is owed around an
 * export: what the file will be (plaintext, ADR 0013), and what it turned out
 * to hold. Neither is worth anything if it arrives after the archive does.
 */

const ARCHIVE = {
  exportId: "export-1",
  location: "file:///staging/export-1/cyd-bluesky-alice.example-2026-09-10.cyd",
  fileName: "cyd-bluesky-alice.example-2026-09-10.cyd",
  byteLength: 4 * 1024 * 1024,
  metadata: { completeness: "incomplete" },
  assets: { total: 3, available: 2, missing: 1, unavailable: 0 },
};

type Doubles = {
  runtime: BlueskyArchiveExportRuntime;
  runExport: jest.Mock;
  share: jest.Mock;
};

function testDoubles(): Doubles {
  const runExport = jest.fn().mockResolvedValue(ARCHIVE);
  const share = jest.fn().mockResolvedValue(undefined);
  return {
    runExport,
    share,
    runtime: {
      portableSettings: jest.fn().mockResolvedValue({ save_posts: true }),
      runExport,
      staging: {
        openStaging: jest.fn(() => ({ destroy: jest.fn() })),
        listStagingIds: jest.fn(() => []),
      },
      share,
      newExportId: jest.fn(() => "export-1"),
    } as unknown as BlueskyArchiveExportRuntime,
  };
}

function renderCard(doubles = testDoubles()): Doubles {
  render(
    <DevArchiveExportCard
      accountId={1}
      accountUUID="018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12"
      palette={Colors.light}
      runtime={doubles.runtime}
    />,
  );
  return doubles;
}

function setDevBuild(value: boolean): void {
  (global as unknown as { __DEV__: boolean }).__DEV__ = value;
}

describe("DevArchiveExportCard", () => {
  const wasDev = (global as unknown as { __DEV__: boolean }).__DEV__;

  beforeEach(() => {
    setDevBuild(true);
  });

  afterEach(() => {
    setDevBuild(wasDev);
    jest.clearAllMocks();
  });

  it("renders nothing in a release build", () => {
    setDevBuild(false);

    renderCard();

    expect(screen.queryByText(/Export archive/)).toBeNull();
  });

  it("offers export in a development build", () => {
    renderCard();

    expect(screen.getByText("Export archive")).toBeTruthy();
    expect(screen.getByText(/Not available in release builds/)).toBeTruthy();
  });

  it("says the archive is not encrypted, and writes nothing until that is answered", async () => {
    const { runExport } = renderCard();

    fireEvent.press(screen.getByText("Export archive"));

    await waitFor(() => {
      expect(screen.getByText(/not encrypted/)).toBeTruthy();
    });
    expect(screen.getByText(/plain text/)).toBeTruthy();
    expect(runExport).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText("Not now"));

    await waitFor(() => {
      expect(screen.queryByText(/not encrypted/)).toBeNull();
    });
    expect(runExport).not.toHaveBeenCalled();
  });

  it("reports what the export produced, including what it could not include", async () => {
    const { share } = renderCard();

    fireEvent.press(screen.getByText("Export archive"));
    await waitFor(() => {
      expect(screen.getByText("Export anyway")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Export anyway"));

    await waitFor(() => {
      expect(screen.getByText(ARCHIVE.fileName)).toBeTruthy();
    });
    expect(share).toHaveBeenCalledWith({
      location: ARCHIVE.location,
      fileName: ARCHIVE.fileName,
    });
    expect(screen.getByText(/2 media files packaged/)).toBeTruthy();
    // Missing and unavailable are different things, and the report keeps them
    // apart: this archive is short one file Cyd never finished saving.
    expect(
      screen.getByText(/1 file Cyd never finished saving is named/),
    ).toBeTruthy();
  });

  /**
   * Getting your own data out of Cyd is not a premium feature (ADR 0015).
   * Nothing in this flow may reach for a Cyd account, and rendering it with no
   * `CydAccountProvider` above it is what proves that: `useCydAccount` throws
   * outside one, so an entitlement check anywhere in here would fail this.
   */
  it("exports with no Cyd account signed in at all", async () => {
    const { share } = renderCard();

    fireEvent.press(screen.getByText("Export archive"));
    await waitFor(() => {
      expect(screen.getByText("Export anyway")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Export anyway"));

    await waitFor(() => {
      expect(share).toHaveBeenCalled();
    });
  });
});
