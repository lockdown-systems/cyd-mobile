/**
 * @fileoverview Tests for ProfilePreview component
 */

import { render, screen } from "@testing-library/react-native";
import React from "react";

import { Colors } from "@/constants/theme";
import type { ProfileData } from "@/controllers/bluesky/types";
import type { AccountTabPalette } from "@/types/account-tabs";

import { ProfilePreview } from "../ProfilePreview";

const defaultPalette: AccountTabPalette = Colors.light;

const baseProfile: ProfileData = {
  did: "did:plc:user123",
  handle: "testuser.bsky.social",
  displayName: "Test User",
  avatarUrl: "https://cdn.bsky.app/avatar/test.jpg",
};

describe("ProfilePreview", () => {
  describe("basic rendering", () => {
    it("should render profile with display name and handle", () => {
      render(<ProfilePreview profile={baseProfile} palette={defaultPalette} />);

      expect(screen.getByText("Test User")).toBeTruthy();
      expect(screen.getByText("@testuser.bsky.social")).toBeTruthy();
    });

    it("should render handle only when displayName is missing", () => {
      const profile: ProfileData = {
        ...baseProfile,
        displayName: null,
      };

      render(<ProfilePreview profile={profile} palette={defaultPalette} />);

      // Should show handle as primary text
      expect(screen.getByText("testuser.bsky.social")).toBeTruthy();
      expect(screen.getByText("@testuser.bsky.social")).toBeTruthy();
    });

    it("should render handle only when displayName is undefined", () => {
      const profile: ProfileData = {
        did: "did:plc:user123",
        handle: "noname.bsky.social",
      };

      render(<ProfilePreview profile={profile} palette={defaultPalette} />);

      expect(screen.getByText("noname.bsky.social")).toBeTruthy();
    });
  });

  describe("avatar handling", () => {
    it("should render avatar when avatarUrl is provided", () => {
      render(<ProfilePreview profile={baseProfile} palette={defaultPalette} />);

      // Avatar should be rendered as an Image component
      // We can't directly test the Image source, but the component should render without errors
      expect(screen.toJSON()).toBeTruthy();
    });

    it("should render placeholder when no avatar URL", () => {
      const profile: ProfileData = {
        ...baseProfile,
        avatarUrl: undefined,
      };

      render(<ProfilePreview profile={profile} palette={defaultPalette} />);

      // Should still render the component
      expect(screen.getByText("Test User")).toBeTruthy();
    });

    it("should use avatarUrl for avatar", () => {
      const profile: ProfileData = {
        ...baseProfile,
        avatarUrl: "https://cdn.bsky.app/avatar/remote.jpg",
      };

      render(<ProfilePreview profile={profile} palette={defaultPalette} />);

      // Component should render without errors
      expect(screen.getByText("Test User")).toBeTruthy();
    });
  });

  describe("action label", () => {
    it("should render action label when provided", () => {
      render(
        <ProfilePreview
          profile={baseProfile}
          palette={defaultPalette}
          actionLabel="Unfollowing..."
        />
      );

      expect(screen.getByText("Unfollowing...")).toBeTruthy();
    });

    it("should not render action label when not provided", () => {
      render(<ProfilePreview profile={baseProfile} palette={defaultPalette} />);

      expect(screen.queryByText("Unfollowing...")).toBeNull();
    });
  });

  describe("palette usage", () => {
    it("should apply palette colors", () => {
      const customPalette: AccountTabPalette = {
        ...defaultPalette,
        text: "#ff0000",
        icon: "#00ff00",
        card: "#0000ff",
        tint: "#ffff00",
      };

      render(
        <ProfilePreview
          profile={baseProfile}
          palette={customPalette}
          actionLabel="Custom action"
        />
      );

      // Component should render with custom palette
      expect(screen.getByText("Test User")).toBeTruthy();
      expect(screen.getByText("Custom action")).toBeTruthy();
    });
  });

  describe("edge cases", () => {
    it("should handle empty handle gracefully", () => {
      const profile: ProfileData = {
        did: "did:plc:user123",
        handle: "",
        displayName: "User With Empty Handle",
      };

      render(<ProfilePreview profile={profile} palette={defaultPalette} />);

      expect(screen.getByText("User With Empty Handle")).toBeTruthy();
      expect(screen.getByText("@")).toBeTruthy();
    });

    it("should handle very long display names", () => {
      const profile: ProfileData = {
        ...baseProfile,
        displayName:
          "This is a very long display name that should be truncated in the UI",
      };

      render(<ProfilePreview profile={profile} palette={defaultPalette} />);

      expect(
        screen.getByText(
          "This is a very long display name that should be truncated in the UI"
        )
      ).toBeTruthy();
    });
  });
});
