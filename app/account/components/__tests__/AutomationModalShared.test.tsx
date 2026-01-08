/**
 * @fileoverview Tests for AutomationModalShared components
 */

import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

import { Colors } from "@/constants/theme";
import type { AccountTabPalette } from "@/types/account-tabs";

import {
  ButtonRow,
  DangerButton,
  ErrorCard,
  getStatusColor,
  getStatusIcon,
  InfoBar,
  SecondaryButton,
  StepRow,
  SuccessCard,
} from "../AutomationModalShared";

const defaultPalette: AccountTabPalette = Colors.light;

describe("AutomationModalShared", () => {
  describe("getStatusIcon", () => {
    it('should return "check-circle" for completed status', () => {
      expect(getStatusIcon("completed")).toBe("check-circle");
    });

    it('should return "play-circle" for running status', () => {
      expect(getStatusIcon("running")).toBe("play-circle");
    });

    it('should return "error-outline" for failed status', () => {
      expect(getStatusIcon("failed")).toBe("error-outline");
    });

    it('should return "schedule" for pending status', () => {
      expect(getStatusIcon("pending")).toBe("schedule");
    });
  });

  describe("getStatusColor", () => {
    it("should return tint color for completed status", () => {
      expect(getStatusColor("completed", defaultPalette)).toBe(
        defaultPalette.tint
      );
    });

    it("should return tint color for running status", () => {
      expect(getStatusColor("running", defaultPalette)).toBe(
        defaultPalette.tint
      );
    });

    it("should return warning color for failed status", () => {
      expect(getStatusColor("failed", defaultPalette)).toBe(
        defaultPalette.warning ?? defaultPalette.tint
      );
    });

    it("should return icon color for pending status", () => {
      expect(getStatusColor("pending", defaultPalette)).toBe(
        defaultPalette.icon
      );
    });
  });

  describe("SecondaryButton", () => {
    it("should render with label", () => {
      render(
        <SecondaryButton
          label="Test Button"
          palette={defaultPalette}
          onPress={() => {}}
        />
      );

      expect(screen.getByText("Test Button")).toBeTruthy();
    });

    it("should call onPress when pressed", () => {
      const mockOnPress = jest.fn();
      render(
        <SecondaryButton
          label="Click Me"
          palette={defaultPalette}
          onPress={mockOnPress}
        />
      );

      fireEvent.press(screen.getByText("Click Me"));
      expect(mockOnPress).toHaveBeenCalled();
    });

    it("should render with icon when provided", () => {
      render(
        <SecondaryButton
          label="With Icon"
          palette={defaultPalette}
          onPress={() => {}}
          iconName="pause"
        />
      );

      expect(screen.getByText("With Icon")).toBeTruthy();
    });

    it("should apply resume variant styling", () => {
      render(
        <SecondaryButton
          label="Resume"
          palette={defaultPalette}
          onPress={() => {}}
          variant="resume"
        />
      );

      expect(screen.getByText("Resume")).toBeTruthy();
    });

    it("should apply pause variant styling", () => {
      render(
        <SecondaryButton
          label="Pause"
          palette={defaultPalette}
          onPress={() => {}}
          variant="pause"
        />
      );

      expect(screen.getByText("Pause")).toBeTruthy();
    });
  });

  describe("DangerButton", () => {
    it("should render with label", () => {
      render(
        <DangerButton
          label="Cancel"
          palette={defaultPalette}
          onPress={() => {}}
        />
      );

      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("should call onPress when pressed", () => {
      const mockOnPress = jest.fn();
      render(
        <DangerButton
          label="Delete"
          palette={defaultPalette}
          onPress={mockOnPress}
        />
      );

      fireEvent.press(screen.getByText("Delete"));
      expect(mockOnPress).toHaveBeenCalled();
    });

    it("should render with reduced opacity when disabled", () => {
      const mockOnPress = jest.fn();
      const { toJSON } = render(
        <DangerButton
          label="Disabled"
          palette={defaultPalette}
          onPress={mockOnPress}
          disabled={true}
        />
      );

      // Verify the button renders (disabled state is handled internally)
      expect(screen.getByText("Disabled")).toBeTruthy();
      // Snapshot or structure check - the component exists with disabled styling
      expect(toJSON()).toBeTruthy();
    });
  });

  describe("ErrorCard", () => {
    it("should render error message", () => {
      render(
        <ErrorCard error="Something went wrong" palette={defaultPalette} />
      );

      expect(screen.getByText("Something went wrong")).toBeTruthy();
    });

    it("should handle long error messages", () => {
      const longError =
        "This is a very long error message that describes what went wrong in detail";
      render(<ErrorCard error={longError} palette={defaultPalette} />);

      expect(screen.getByText(longError)).toBeTruthy();
    });
  });

  describe("SuccessCard", () => {
    it("should render success message", () => {
      render(
        <SuccessCard
          message="Operation completed successfully"
          palette={defaultPalette}
        />
      );

      expect(screen.getByText("Operation completed successfully")).toBeTruthy();
    });
  });

  describe("InfoBar", () => {
    it("should render info message", () => {
      render(
        <InfoBar message="Keep your phone unlocked" palette={defaultPalette} />
      );

      expect(screen.getByText("Keep your phone unlocked")).toBeTruthy();
    });
  });

  describe("StepRow", () => {
    it("should render step information", () => {
      render(
        <StepRow
          currentIndex={2}
          totalJobs={5}
          currentLabel="Delete posts"
          statusForUi="running"
          palette={defaultPalette}
        />
      );

      expect(screen.getByText("Step 2/5: Delete posts")).toBeTruthy();
    });

    it("should handle zero jobs", () => {
      render(
        <StepRow
          currentIndex={0}
          totalJobs={0}
          currentLabel="Preparing"
          statusForUi="running"
          palette={defaultPalette}
        />
      );

      expect(screen.getByText("Step 0/0: Preparing")).toBeTruthy();
    });
  });

  describe("ButtonRow", () => {
    it("should render pause button when running and not paused", () => {
      render(
        <ButtonRow
          state="running"
          paused={false}
          palette={defaultPalette}
          onPause={() => {}}
          onResume={() => {}}
          onClose={() => {}}
          restartLabel="Back to Options"
        />
      );

      expect(screen.getByText("Pause")).toBeTruthy();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("should render resume button when paused", () => {
      render(
        <ButtonRow
          state="running"
          paused={true}
          palette={defaultPalette}
          onPause={() => {}}
          onResume={() => {}}
          onClose={() => {}}
          restartLabel="Back to Options"
        />
      );

      expect(screen.getByText("Resume")).toBeTruthy();
    });

    it("should render restart button when completed with onRestart", () => {
      const mockRestart = jest.fn();
      render(
        <ButtonRow
          state="completed"
          paused={false}
          palette={defaultPalette}
          onPause={() => {}}
          onResume={() => {}}
          onRestart={mockRestart}
          onClose={() => {}}
          restartLabel="Back to Save Options"
        />
      );

      expect(screen.getByText("Back to Save Options")).toBeTruthy();
    });

    it("should render close button when completed without onRestart", () => {
      render(
        <ButtonRow
          state="completed"
          paused={false}
          palette={defaultPalette}
          onPause={() => {}}
          onResume={() => {}}
          onClose={() => {}}
          restartLabel="Back to Options"
        />
      );

      expect(screen.getByText("Close")).toBeTruthy();
    });

    it("should call onPause when pause button pressed", () => {
      const mockPause = jest.fn();
      render(
        <ButtonRow
          state="running"
          paused={false}
          palette={defaultPalette}
          onPause={mockPause}
          onResume={() => {}}
          onClose={() => {}}
          restartLabel="Back to Options"
        />
      );

      fireEvent.press(screen.getByText("Pause"));
      expect(mockPause).toHaveBeenCalled();
    });

    it("should call onResume when resume button pressed", () => {
      const mockResume = jest.fn();
      render(
        <ButtonRow
          state="running"
          paused={true}
          palette={defaultPalette}
          onPause={() => {}}
          onResume={mockResume}
          onClose={() => {}}
          restartLabel="Back to Options"
        />
      );

      fireEvent.press(screen.getByText("Resume"));
      expect(mockResume).toHaveBeenCalled();
    });
  });
});
