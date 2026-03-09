import { render } from "@testing-library/react-native";
import React from "react";

import type { SaveJobOptions } from "@/controllers/bluesky/job-types";
import type { AccountTabPalette } from "@/types/account-tabs";

import { SaveAutomationModal } from "../SaveAutomationModal";

const mockGetBlueskyController: jest.MockedFunction<
  (accountId: number, accountUUID: string) => Promise<unknown>
> = jest.fn();

jest.mock("@/controllers", () => ({
  getBlueskyController: mockGetBlueskyController,
}));

jest.mock("@/hooks/use-modal-bottom-padding", () => ({
  useModalBottomPadding: () => 0,
}));

jest.mock("@/components/cyd/SpeechBubble", () => ({
  SpeechBubble: () => null,
}));

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

const mockOptions: SaveJobOptions = {
  posts: true,
  likes: true,
  bookmarks: true,
  chat: true,
};

describe("SaveAutomationModal visibility behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not acquire a controller when hidden", () => {
    render(
      <SaveAutomationModal
        visible={false}
        accountId={1}
        accountUUID="account-uuid"
        palette={mockPalette}
        options={mockOptions}
        onFinished={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(mockGetBlueskyController).not.toHaveBeenCalled();
  });
});
