import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import { BlueskyArchiveExportModal } from "@/components/BlueskyArchiveExportModal";
import {
  useBlueskyArchiveExport,
  type BlueskyArchiveExportRuntime,
} from "@/hooks/use-bluesky-archive-export";

/**
 * Export as somebody meets it: from the app-wide menu, with the hook behind it.
 *
 * The modal and the hook are driven together rather than apart, because what
 * matters about this flow is an ordering that spans both — the plaintext
 * warning arrives before the file exists (ADR 0013), the archive is held until
 * somebody says where it goes, and staging is cleared only once it is
 * somewhere else (#99).
 *
 * Nothing renders a `CydAccountProvider`, which is the point of the last test:
 * `useCydAccount` throws outside one, so an entitlement check anywhere in this
 * flow would fail rather than quietly paywall recovery (ADR 0015).
 */

jest.mock("@/hooks/use-color-scheme", () => ({
  useColorScheme: () => "light",
}));

const ACCOUNT = {
  id: 1,
  uuid: "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12",
  handle: "alice.example",
};
const OTHER_ACCOUNT = {
  id: 2,
  uuid: "6f1a0f56-5f52-4a44-9c6e-2d5b0c9f7a31",
  handle: "bob.example",
};

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
  saveToDevice: jest.Mock;
  destroy: jest.Mock;
};

function testDoubles(
  accounts: { id: number; uuid: string; handle: string }[] = [ACCOUNT],
): Doubles {
  const runExport = jest.fn().mockResolvedValue(ARCHIVE);
  const share = jest.fn().mockResolvedValue(undefined);
  const saveToDevice = jest.fn().mockResolvedValue("Documents");
  const destroy = jest.fn();
  return {
    runExport,
    share,
    saveToDevice,
    destroy,
    runtime: {
      listAccounts: jest.fn().mockResolvedValue(accounts),
      portableSettings: jest.fn().mockResolvedValue({ save_posts: true }),
      runExport,
      staging: {
        openStaging: jest.fn(() => ({ destroy })),
        listStagingIds: jest.fn(() => []),
      },
      share,
      saveToDevice,
      newExportId: jest.fn(() => "export-1"),
    } as unknown as BlueskyArchiveExportRuntime,
  };
}

/** The menu item and the modal it opens, which is the whole of the flow. */
function ExportFlow({ runtime }: { runtime: BlueskyArchiveExportRuntime }) {
  const archiveExport = useBlueskyArchiveExport({ runtime });
  return (
    <>
      <BlueskyArchiveExportModal
        state={archiveExport.state}
        onChoose={(account) => void archiveExport.choose(account)}
        onConfirm={() => void archiveExport.confirm()}
        onSaveToDevice={() => void archiveExport.saveToDevice()}
        onShare={() => void archiveExport.share()}
        onCancel={archiveExport.cancel}
        onDismiss={archiveExport.dismiss}
      />
      <MenuItem onPress={() => void archiveExport.start()} />
    </>
  );
}

function MenuItem({ onPress }: { onPress: () => void }) {
  return (
    <Text accessibilityRole="button" onPress={onPress}>
      Export Bluesky archive
    </Text>
  );
}

function openExport(doubles = testDoubles()): Doubles {
  render(<ExportFlow runtime={doubles.runtime} />);
  fireEvent.press(screen.getByText("Export Bluesky archive"));
  return doubles;
}

describe("exporting a Cyd Bluesky archive from the menu", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows nothing until somebody asks for an export", () => {
    render(<ExportFlow runtime={testDoubles().runtime} />);

    expect(screen.queryByText(/not encrypted/)).toBeNull();
  });

  it("says the archive is not encrypted, and writes nothing until that is answered", async () => {
    const { runExport } = openExport();

    await waitFor(() => {
      expect(screen.getByText("This archive is not encrypted")).toBeTruthy();
    });
    expect(screen.getByText(/plain text/)).toBeTruthy();
    expect(runExport).not.toHaveBeenCalled();
  });

  it("names the account the archive would be written from", async () => {
    openExport();

    await waitFor(() => {
      // Zero-width spaces let a handle wrap where a reader would break it.
      expect(screen.getByText(/alice/)).toBeTruthy();
    });
  });

  it("asks which account when this device holds more than one", async () => {
    openExport(testDoubles([ACCOUNT, OTHER_ACCOUNT]));

    await waitFor(() => {
      expect(screen.getByText("Which account?")).toBeTruthy();
    });
    fireEvent.press(screen.getByText(/bob/));

    await waitFor(() => {
      expect(screen.getByText("This archive is not encrypted")).toBeTruthy();
    });
  });

  it("reports what the export produced, including what it could not include", async () => {
    openExport();

    await waitFor(() => {
      expect(screen.getByText("Export anyway")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Export anyway"));

    await waitFor(() => {
      expect(screen.getByText(ARCHIVE.fileName)).toBeTruthy();
    });
    expect(screen.getByText(/2 media files packaged/)).toBeTruthy();
    expect(screen.getByText(/1 file Cyd never finished saving/)).toBeTruthy();
  });

  it("offers to save the archive to the device, not only to share it", async () => {
    const { saveToDevice, share } = openExport();

    await waitFor(() => {
      expect(screen.getByText("Export anyway")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Export anyway"));

    await waitFor(() => {
      expect(screen.getByText("Save to device")).toBeTruthy();
    });
    expect(screen.getByText("Share")).toBeTruthy();

    fireEvent.press(screen.getByText("Save to device"));
    await waitFor(() => {
      expect(saveToDevice).toHaveBeenCalled();
    });
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByText("Exported")).toBeTruthy();
  });

  /**
   * Getting your own data out of Cyd is not a premium feature (ADR 0015).
   * Nothing in this flow may reach for a Cyd account, and rendering it with no
   * `CydAccountProvider` above it is what proves that: `useCydAccount` throws
   * outside one, so an entitlement check anywhere in here would fail this.
   */
  it("exports with no Cyd account signed in at all", async () => {
    const { share } = openExport();

    await waitFor(() => {
      expect(screen.getByText("Export anyway")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Export anyway"));

    await waitFor(() => {
      expect(screen.getByText("Share")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Share"));

    await waitFor(() => {
      expect(share).toHaveBeenCalled();
    });
  });
});
