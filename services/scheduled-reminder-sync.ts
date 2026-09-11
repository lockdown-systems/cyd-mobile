import * as Localization from "expo-localization";

import { listAccounts } from "@/database/accounts";
import { getAccountScheduleSettings } from "@/database/schedule-settings";
import type CydAPIClient from "@/services/cyd-api-client";
import {
  hasNotificationPermission,
  registerForPushNotifications,
} from "@/services/push-notifications";

/**
 * Keeping server-scheduled Bluesky reminders pointed at the right account.
 *
 * Mobile delivers reminders as push scheduled by Cyd's server, keyed by the
 * local-account UUID (ADR 0005). A merge never touches that — the account
 * keeps its UUID and its schedule — but reconciling duplicates does: one UUID
 * stops existing, and the survivor may come out of it holding a schedule that
 * belonged to the other one, which the server has no push token for.
 *
 * So reconciliation ends by telling the server what is true now. A reminder
 * still only prompts somebody to open Cyd and review: nothing here authorizes
 * unattended deletion, and there is nothing in the payload that could.
 */
export type ScheduledReminderSync = {
  /** Re-send the surviving account's schedule, and the token to deliver it. */
  resync(accountUuid: string): Promise<void>;
  /** Stop reminders for a Bluesky local account that no longer exists. */
  retire(accountUuid: string): Promise<void>;
};

/** Used when there is no Cyd account, and so no server-scheduled reminders. */
export const NO_SCHEDULED_REMINDERS: ScheduledReminderSync = {
  resync: async () => {},
  retire: async () => {},
};

export function createScheduledReminderSync(
  apiClient: CydAPIClient,
  isSignedIn: boolean,
): ScheduledReminderSync {
  if (!isSignedIn) {
    return NO_SCHEDULED_REMINDERS;
  }

  return {
    resync: async (accountUuid) => {
      const account = (await listAccounts()).find(
        (candidate) => candidate.uuid === accountUuid,
      );
      if (!account) {
        return;
      }
      const settings = await getAccountScheduleSettings(account.id);

      // A schedule the survivor inherited may never have had a push token
      // bound to this UUID, and the server cannot deliver a reminder without
      // one. Permission is only ever read here, never asked for: an import is
      // the wrong moment to put a notifications prompt in front of somebody,
      // and a person with no permission granted had no reminders to keep.
      if (settings.scheduleDeletion && (await hasNotificationPermission())) {
        const token = await registerForPushNotifications();
        if (token.success && token.token && token.platform) {
          await apiClient.registerPushToken({
            push_token: token.token,
            platform: token.platform,
            account_uuid: accountUuid,
            account_handle: account.handle,
            timezone: Localization.getCalendars()[0]?.timeZone ?? "UTC",
          });
        }
      }

      await apiClient.updateScheduleSettings({
        account_uuid: accountUuid,
        schedule_enabled: settings.scheduleDeletion,
        schedule_frequency: settings.scheduleDeletionFrequency,
        schedule_day_of_month: settings.scheduleDeletionDayOfMonth,
        schedule_day_of_week: settings.scheduleDeletionDayOfWeek,
        schedule_time: settings.scheduleDeletionTime,
      });
    },

    retire: async (accountUuid) => {
      await apiClient.unregisterPushToken({ account_uuid: accountUuid });
    },
  };
}
