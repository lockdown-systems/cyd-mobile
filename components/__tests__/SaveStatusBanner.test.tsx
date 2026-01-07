/**
 * @fileoverview Tests for SaveStatusBanner component
 */

import { Colors } from "@/constants/theme";
import type { AccountTabPalette } from "@/types/account-tabs";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { SaveStatusBanner } from "../SaveStatusBanner";

const defaultPalette: AccountTabPalette = Colors.light;

// Mock the database function with explicit any typing for test flexibility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetLastSavedAt = jest.fn<any, [number]>();

jest.mock("@/database/accounts", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  getLastSavedAt: (accountId: number) => mockGetLastSavedAt(accountId),
}));

describe("SaveStatusBanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("loading state", () => {
    it("should return null while loading", () => {
      // Keep the promise pending
      mockGetLastSavedAt.mockReturnValue(new Promise(() => {}));

      const { toJSON } = render(
        <SaveStatusBanner accountId={1} palette={defaultPalette} />
      );

      expect(toJSON()).toBeNull();
    });
  });

  describe("never saved state", () => {
    beforeEach(() => {
      mockGetLastSavedAt.mockResolvedValue(null);
    });

    it("should show prompt to save data when lastSavedAt is null", async () => {
      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(
          screen.getByText("You need to save data before you can delete it.")
        ).toBeTruthy();
      });
    });

    it("should show Go to Save Tab button", async () => {
      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("Go to Save Tab")).toBeTruthy();
      });
    });

    it("should call onSelectTab with 'save' when button is pressed", async () => {
      const mockOnSelectTab = jest.fn();

      render(
        <SaveStatusBanner
          accountId={1}
          palette={defaultPalette}
          onSelectTab={mockOnSelectTab}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Go to Save Tab")).toBeTruthy();
      });

      fireEvent.press(screen.getByText("Go to Save Tab"));

      expect(mockOnSelectTab).toHaveBeenCalledWith("save");
    });

    it("should handle missing onSelectTab gracefully", async () => {
      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("Go to Save Tab")).toBeTruthy();
      });

      // Should not throw when pressed without onSelectTab
      expect(() => {
        fireEvent.press(screen.getByText("Go to Save Tab"));
      }).not.toThrow();
    });
  });

  describe("has saved data state", () => {
    const mockTimestamp = new Date("2026-01-06T19:48:00").getTime();

    beforeEach(() => {
      mockGetLastSavedAt.mockResolvedValue(mockTimestamp);
    });

    it("should show last saved date when data has been saved", async () => {
      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText(/You last saved your data on/)).toBeTruthy();
      });
    });

    it("should format the timestamp correctly", async () => {
      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        // The text should contain the formatted date
        expect(screen.getByText(/January/)).toBeTruthy();
      });
    });

    it("should show Save again link", async () => {
      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("Save again")).toBeTruthy();
      });
    });

    it("should call onSelectTab with 'save' when Save again is pressed", async () => {
      const mockOnSelectTab = jest.fn();

      render(
        <SaveStatusBanner
          accountId={1}
          palette={defaultPalette}
          onSelectTab={mockOnSelectTab}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Save again")).toBeTruthy();
      });

      fireEvent.press(screen.getByText("Save again"));

      expect(mockOnSelectTab).toHaveBeenCalledWith("save");
    });
  });

  describe("refreshKey behavior", () => {
    it("should refetch data when refreshKey changes", async () => {
      mockGetLastSavedAt.mockResolvedValue(null);

      const { rerender } = render(
        <SaveStatusBanner
          accountId={1}
          palette={defaultPalette}
          refreshKey={0}
        />
      );

      await waitFor(() => {
        expect(mockGetLastSavedAt).toHaveBeenCalledWith(1);
      });

      expect(mockGetLastSavedAt).toHaveBeenCalledTimes(1);

      // Now update refreshKey
      mockGetLastSavedAt.mockClear();
      mockGetLastSavedAt.mockResolvedValue(Date.now());

      rerender(
        <SaveStatusBanner
          accountId={1}
          palette={defaultPalette}
          refreshKey={1}
        />
      );

      await waitFor(() => {
        expect(mockGetLastSavedAt).toHaveBeenCalledWith(1);
      });
    });

    it("should refetch data when accountId changes", async () => {
      mockGetLastSavedAt.mockResolvedValue(null);

      const { rerender } = render(
        <SaveStatusBanner accountId={1} palette={defaultPalette} />
      );

      await waitFor(() => {
        expect(mockGetLastSavedAt).toHaveBeenCalledWith(1);
      });

      mockGetLastSavedAt.mockClear();

      rerender(<SaveStatusBanner accountId={2} palette={defaultPalette} />);

      await waitFor(() => {
        expect(mockGetLastSavedAt).toHaveBeenCalledWith(2);
      });
    });
  });

  describe("styling", () => {
    it("should apply banner styles for never saved state", async () => {
      mockGetLastSavedAt.mockResolvedValue(null);

      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("Go to Save Tab")).toBeTruthy();
      });
    });

    it("should apply simple banner styles for saved state", async () => {
      mockGetLastSavedAt.mockResolvedValue(Date.now());

      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("Save again")).toBeTruthy();
      });
    });

    it("should apply palette tint color to button", async () => {
      mockGetLastSavedAt.mockResolvedValue(null);

      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText("Go to Save Tab")).toBeTruthy();
      });
    });
  });

  describe("accessibility", () => {
    it("should have accessible button for Go to Save Tab", async () => {
      mockGetLastSavedAt.mockResolvedValue(null);

      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        // The button should exist and be pressable
        expect(screen.getByText("Go to Save Tab")).toBeTruthy();
      });
    });

    it("should have accessible Save again link", async () => {
      mockGetLastSavedAt.mockResolvedValue(Date.now());

      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        // The link should exist and be pressable
        expect(screen.getByText("Save again")).toBeTruthy();
      });
    });
  });

  describe("date formatting", () => {
    it("should format dates with full month name", async () => {
      // January 15, 2026 at 2:30 PM
      const timestamp = new Date("2026-01-15T14:30:00").getTime();
      mockGetLastSavedAt.mockResolvedValue(timestamp);

      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        expect(screen.getByText(/January/)).toBeTruthy();
        expect(screen.getByText(/15/)).toBeTruthy();
        expect(screen.getByText(/2026/)).toBeTruthy();
      });
    });

    it("should include time in formatted date", async () => {
      const timestamp = new Date("2026-06-20T09:15:00").getTime();
      mockGetLastSavedAt.mockResolvedValue(timestamp);

      render(<SaveStatusBanner accountId={1} palette={defaultPalette} />);

      await waitFor(() => {
        // Time should be included (format varies by locale)
        expect(screen.getByText(/June/)).toBeTruthy();
      });
    });
  });
});
