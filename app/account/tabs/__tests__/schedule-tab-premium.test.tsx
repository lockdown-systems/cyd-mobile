import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { Colors } from "@/constants/theme";
import { useCydAccount } from "@/contexts/CydAccountProvider";
import { getAccountDeleteSettings } from "@/database/delete-settings";

import { ScheduleTab } from "../schedule-tab";

const mockCheckPremiumAccess = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ scheduleShowReview: "true" }),
}));
jest.mock("@react-native-community/datetimepicker", () => () => null);
jest.mock("expo-localization", () => ({
  getCalendars: () => [{ timeZone: "UTC" }],
}));
jest.mock("@/services/push-notifications", () => ({
  registerForPushNotifications: jest.fn(),
}));

jest.mock("@/contexts/CydAccountProvider", () => ({
  useCydAccount: jest.fn(),
}));

jest.mock("@/database/accounts", () => ({
  getAccountHandle: jest.fn().mockResolvedValue("alice.test"),
  getLastDeletedAt: jest.fn().mockResolvedValue(Date.now()),
  getLastSavedAt: jest.fn().mockResolvedValue(Date.now()),
  setLastDeletedAt: jest.fn().mockResolvedValue(undefined),
  setLastSavedAt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/database/schedule-settings", () => ({
  getAccountScheduleSettings: jest.fn().mockResolvedValue({
    scheduleDeletion: true,
    scheduleDeletionFrequency: "weekly",
    scheduleDeletionDayOfMonth: 1,
    scheduleDeletionDayOfWeek: 0,
    scheduleDeletionTime: "09:00",
  }),
  updateAccountScheduleSettings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/database/save-settings", () => ({
  getAccountSaveSettings: jest.fn().mockResolvedValue({
    posts: true,
    likes: true,
    bookmarks: true,
    chat: true,
  }),
}));

jest.mock("@/database/delete-settings", () => ({
  getAccountDeleteSettings: jest.fn(),
}));

jest.mock("@/app/account/components/SaveReviewList", () => ({
  SaveReviewList: () => null,
}));
jest.mock("@/app/account/components/DeleteReviewList", () => ({
  DeleteReviewList: () => null,
}));
jest.mock("@/components/PremiumRequiredBanner", () => ({
  PremiumRequiredBanner: () => null,
}));
jest.mock("@/components/PremiumRequiredModal", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { Pressable, Text } = require("react-native");
  return {
    PremiumRequiredModal: ({
      visible,
      onPremiumConfirmed,
    }: {
      visible: boolean;
      onPremiumConfirmed: () => void;
    }) =>
      visible ? (
        <Pressable testID="premium-required-modal" onPress={onPremiumConfirmed}>
          <Text>Premium required</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock("@/components/SaveAndDeleteStatusBanner", () => ({
  SaveAndDeleteStatusBanner: () => null,
}));
jest.mock("@/components/LastActionTimestamp", () => ({
  LastActionTimestamp: () => null,
}));
jest.mock("@/app/account/components/FinishedModal", () => ({
  FinishedModal: () => null,
}));
jest.mock("@/app/account/components/ScheduledAutomationModal", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const { Text } = require("react-native");
  return {
    ScheduledAutomationModal: ({ visible }: { visible: boolean }) =>
      visible ? <Text testID="scheduled-automation">Automation running</Text> : null,
  };
});

const mockUseCydAccount = useCydAccount as jest.Mock;
const mockGetAccountDeleteSettings = getAccountDeleteSettings as jest.Mock;

const noDeletes = {
  deletePosts: false,
  deletePostsDaysOldEnabled: false,
  deletePostsDaysOld: 0,
  deletePostsLikesThresholdEnabled: false,
  deletePostsLikesThreshold: 0,
  deletePostsRepostsThresholdEnabled: false,
  deletePostsRepostsThreshold: 0,
  deletePostsPreserveThreads: false,
  deleteReposts: false,
  deleteRepostsDaysOldEnabled: false,
  deleteRepostsDaysOld: 0,
  deleteLikes: false,
  deleteLikesDaysOldEnabled: false,
  deleteLikesDaysOld: 0,
  deleteBookmarks: false,
  deleteChats: false,
  deleteChatsDaysOldEnabled: false,
  deleteChatsDaysOld: 0,
  deleteUnfollowEveryone: false,
};

describe("ScheduleTab Premium execution gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCydAccount.mockReturnValue({
      state: {
        isSignedIn: true,
        userEmail: "alice@example.com",
        isLoading: false,
        hasPremiumAccess: true,
      },
      apiClient: {},
      checkPremiumAccess: mockCheckPremiumAccess,
    });
  });

  it("blocks a notification-launched run when cached Premium has expired", async () => {
    mockGetAccountDeleteSettings.mockResolvedValue({
      ...noDeletes,
      deletePosts: true,
    });
    mockCheckPremiumAccess.mockResolvedValue({ status: "not_premium" });

    render(
      <ScheduleTab
        accountId={1}
        accountUUID="account-uuid"
        handle="alice.test"
        palette={Colors.light}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Ready to save and delete your Bluesky data?"),
      ).toBeTruthy(),
    );
    fireEvent.press(screen.getByText("Save and Delete Data Now"));

    await waitFor(() => expect(mockCheckPremiumAccess).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("premium-required-modal")).toBeTruthy();
    expect(screen.queryByTestId("scheduled-automation")).toBeNull();
  });

  it("starts a free-only run without checking Premium or requiring Cyd sign-in", async () => {
    mockGetAccountDeleteSettings.mockResolvedValue(noDeletes);
    mockUseCydAccount.mockReturnValue({
      state: {
        isSignedIn: false,
        userEmail: null,
        isLoading: false,
        hasPremiumAccess: null,
      },
      apiClient: {},
      checkPremiumAccess: mockCheckPremiumAccess,
    });

    render(
      <ScheduleTab
        accountId={1}
        accountUUID="account-uuid"
        handle="alice.test"
        palette={Colors.light}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Save and Delete Data Now")).toBeTruthy(),
    );
    fireEvent.press(screen.getByText("Save and Delete Data Now"));

    await waitFor(() => expect(screen.getByTestId("scheduled-automation")).toBeTruthy());
    expect(mockCheckPremiumAccess).not.toHaveBeenCalled();
  });

  it("starts a Premium run only after a fresh successful check", async () => {
    mockGetAccountDeleteSettings.mockResolvedValue({
      ...noDeletes,
      deleteLikes: true,
    });
    mockCheckPremiumAccess.mockResolvedValue({ status: "premium" });

    render(
      <ScheduleTab
        accountId={1}
        accountUUID="account-uuid"
        handle="alice.test"
        palette={Colors.light}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Save and Delete Data Now")).toBeTruthy(),
    );
    fireEvent.press(screen.getByText("Save and Delete Data Now"));

    await waitFor(() => expect(screen.getByTestId("scheduled-automation")).toBeTruthy());
    expect(mockCheckPremiumAccess).toHaveBeenCalledTimes(1);
  });

  it("re-verifies and resumes the retained run after Premium is confirmed", async () => {
    mockGetAccountDeleteSettings.mockResolvedValue({
      ...noDeletes,
      deleteBookmarks: true,
    });
    mockCheckPremiumAccess
      .mockResolvedValueOnce({ status: "not_premium" })
      .mockResolvedValueOnce({ status: "premium" });

    render(
      <ScheduleTab
        accountId={1}
        accountUUID="account-uuid"
        handle="alice.test"
        palette={Colors.light}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Save and Delete Data Now")).toBeTruthy(),
    );
    fireEvent.press(screen.getByText("Save and Delete Data Now"));
    await waitFor(() =>
      expect(screen.getByTestId("premium-required-modal")).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId("premium-required-modal"));

    await waitFor(() => expect(screen.getByTestId("scheduled-automation")).toBeTruthy());
    expect(mockCheckPremiumAccess).toHaveBeenCalledTimes(2);
  });

  it("coalesces repeated taps while verification is in flight", async () => {
    mockGetAccountDeleteSettings.mockResolvedValue({
      ...noDeletes,
      deleteChats: true,
    });
    let resolveCheck!: (value: { status: "premium" }) => void;
    mockCheckPremiumAccess.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    render(
      <ScheduleTab
        accountId={1}
        accountUUID="account-uuid"
        handle="alice.test"
        palette={Colors.light}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Save and Delete Data Now")).toBeTruthy(),
    );
    const startButton = screen.getByText("Save and Delete Data Now");
    fireEvent.press(startButton);
    fireEvent.press(startButton);

    expect(mockCheckPremiumAccess).toHaveBeenCalledTimes(1);
    resolveCheck({ status: "premium" });
    await waitFor(() => expect(screen.getByTestId("scheduled-automation")).toBeTruthy());
  });
});
