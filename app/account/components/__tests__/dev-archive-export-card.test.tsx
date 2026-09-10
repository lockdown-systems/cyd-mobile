import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { Colors } from "@/constants/theme";

import { DevArchiveExportCard } from "../DevArchiveExportCard";

/**
 * Export must not reach people before #100 proves an archive Mobile writes can
 * be read back (ADR 0004). `__DEV__` is the whole of that gate, so it is worth
 * a test that fails loudly if the affordance ever renders in a release build.
 */

const mockExportBlueskyArchive = jest.fn();

jest.mock("@/controllers", () => ({
  withBlueskyController: jest.fn(
    (
      _accountId: number,
      _accountUUID: string,
      fn: (controller: { exportBlueskyArchive: jest.Mock }) => Promise<unknown>,
    ) => fn({ exportBlueskyArchive: mockExportBlueskyArchive }),
  ),
}));

jest.mock("@/database/accounts", () => ({
  getPortableBlueskySettings: jest.fn().mockResolvedValue({ save_posts: true }),
}));

function renderCard() {
  return render(
    <DevArchiveExportCard
      accountId={1}
      accountUUID="018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12"
      palette={Colors.light}
    />,
  );
}

function setDevBuild(value: boolean): void {
  (global as unknown as { __DEV__: boolean }).__DEV__ = value;
}

describe("DevArchiveExportCard", () => {
  const wasDev = (global as unknown as { __DEV__: boolean }).__DEV__;

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
    setDevBuild(true);

    renderCard();

    expect(screen.getByText("Export archive")).toBeTruthy();
    expect(
      screen.getByText(/Not available in release builds/),
    ).toBeTruthy();
  });

  it("reports what the export produced, including what was unavailable", async () => {
    setDevBuild(true);
    mockExportBlueskyArchive.mockResolvedValue({
      location: "file:///staging/dev-1/cyd-bluesky-alice.example-2026-09-10.cyd",
      byteLength: 2048,
      metadata: { completeness: "incomplete" },
      assets: { total: 3, available: 2, missing: 1, unavailable: 0 },
    });

    renderCard();
    fireEvent.press(screen.getByText("Export archive"));

    await waitFor(() => {
      expect(screen.getByText(/incomplete/)).toBeTruthy();
    });
    expect(screen.getByText(/1 unavailable/)).toBeTruthy();
    expect(
      screen.getByText(/cyd-bluesky-alice.example-2026-09-10.cyd/),
    ).toBeTruthy();
  });

  it("shows why an export failed rather than failing silently", async () => {
    setDevBuild(true);
    mockExportBlueskyArchive.mockRejectedValue(
      new Error("Cyd could not copy this account's data for export"),
    );

    renderCard();
    fireEvent.press(screen.getByText("Export archive"));

    await waitFor(() => {
      expect(screen.getByText(/could not copy this account's data/)).toBeTruthy();
    });
  });
});
