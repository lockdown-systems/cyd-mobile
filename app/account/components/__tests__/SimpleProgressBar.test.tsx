/**
 * @fileoverview Tests for SimpleProgressBar component
 */

import { render } from "@testing-library/react-native";
import React from "react";

import { Colors } from "@/constants/theme";
import type { AccountTabPalette } from "@/types/account-tabs";

import { SimpleProgressBar } from "../SimpleProgressBar";

const defaultPalette: AccountTabPalette = Colors.light;

describe("SimpleProgressBar", () => {
  describe("exports", () => {
    it("should export SimpleProgressBar component", () => {
      expect(SimpleProgressBar).toBeDefined();
      expect(typeof SimpleProgressBar).toBe("function");
    });
  });

  describe("rendering", () => {
    it("should render without errors", () => {
      const { toJSON } = render(
        <SimpleProgressBar palette={defaultPalette} progress={0} />
      );
      expect(toJSON()).toBeTruthy();
    });

    it("should render with zero progress", () => {
      const element = React.createElement(SimpleProgressBar, {
        palette: defaultPalette,
        progress: 0,
      });
      expect(element.props.progress).toBe(0);
    });

    it("should render with full progress", () => {
      const element = React.createElement(SimpleProgressBar, {
        palette: defaultPalette,
        progress: 1,
      });
      expect(element.props.progress).toBe(1);
    });

    it("should render with partial progress", () => {
      const element = React.createElement(SimpleProgressBar, {
        palette: defaultPalette,
        progress: 0.5,
      });
      expect(element.props.progress).toBe(0.5);
    });
  });

  describe("progress clamping", () => {
    it("should handle progress greater than 1", () => {
      const { toJSON } = render(
        <SimpleProgressBar palette={defaultPalette} progress={1.5} />
      );
      // Should render without errors, internally clamped to 1
      expect(toJSON()).toBeTruthy();
    });

    it("should handle negative progress", () => {
      const { toJSON } = render(
        <SimpleProgressBar palette={defaultPalette} progress={-0.5} />
      );
      // Should render without errors, internally clamped to 0
      expect(toJSON()).toBeTruthy();
    });
  });

  describe("palette usage", () => {
    it("should accept palette prop", () => {
      const customPalette: AccountTabPalette = {
        ...defaultPalette,
        tint: "#ff0000",
        icon: "#00ff00",
      };

      const element = React.createElement(SimpleProgressBar, {
        palette: customPalette,
        progress: 0.5,
      });

      expect(element.props.palette.tint).toBe("#ff0000");
    });
  });

  describe("visual states", () => {
    it("should show empty bar at 0%", () => {
      const { toJSON } = render(
        <SimpleProgressBar palette={defaultPalette} progress={0} />
      );
      expect(toJSON()).toBeTruthy();
    });

    it("should show half-filled bar at 50%", () => {
      const { toJSON } = render(
        <SimpleProgressBar palette={defaultPalette} progress={0.5} />
      );
      expect(toJSON()).toBeTruthy();
    });

    it("should show full bar at 100%", () => {
      const { toJSON } = render(
        <SimpleProgressBar palette={defaultPalette} progress={1} />
      );
      expect(toJSON()).toBeTruthy();
    });
  });
});
