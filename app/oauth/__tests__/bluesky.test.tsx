import { act, render } from "@testing-library/react-native";
import React from "react";

import BlueskyOAuthCallbackScreen from "../bluesky";

const mockRouter = {
  canGoBack: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
};

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}));

describe("BlueskyOAuthCallbackScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("navigates back when there is navigation history", () => {
    mockRouter.canGoBack.mockReturnValue(true);

    render(<BlueskyOAuthCallbackScreen />);

    act(() => {
      jest.runAllTimers();
    });

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("replaces to home when there is no navigation history", () => {
    mockRouter.canGoBack.mockReturnValue(false);

    render(<BlueskyOAuthCallbackScreen />);

    act(() => {
      jest.runAllTimers();
    });

    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });
});
