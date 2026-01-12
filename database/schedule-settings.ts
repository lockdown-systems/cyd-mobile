import { getDatabase } from "./index";

export type ScheduleFrequency = "daily" | "weekly" | "monthly";

export type AccountScheduleSettings = {
  scheduleDeletion: boolean;
  scheduleDeletionFrequency: ScheduleFrequency;
  scheduleDeletionDayOfMonth: number;
  scheduleDeletionDayOfWeek: number;
  scheduleDeletionTime: string;
};

const DEFAULT_SCHEDULE_SETTINGS: AccountScheduleSettings = {
  scheduleDeletion: false,
  scheduleDeletionFrequency: "weekly",
  scheduleDeletionDayOfMonth: 1,
  scheduleDeletionDayOfWeek: 0, // Sunday
  scheduleDeletionTime: "09:00",
};

export type ScheduleSettingsRow = {
  settingScheduleDeletion: number | null;
  settingScheduleDeletionFrequency: string | null;
  settingScheduleDeletionDayOfMonth: number | null;
  settingScheduleDeletionDayOfWeek: number | null;
  settingScheduleDeletionTime: string | null;
};

function mapRowToSettings(
  row: ScheduleSettingsRow | null
): AccountScheduleSettings {
  if (!row) {
    return { ...DEFAULT_SCHEDULE_SETTINGS };
  }

  const frequency = row.settingScheduleDeletionFrequency as ScheduleFrequency;
  const validFrequencies: ScheduleFrequency[] = ["daily", "weekly", "monthly"];

  return {
    scheduleDeletion: Boolean(row.settingScheduleDeletion),
    scheduleDeletionFrequency: validFrequencies.includes(frequency)
      ? frequency
      : "weekly",
    scheduleDeletionDayOfMonth: row.settingScheduleDeletionDayOfMonth ?? 1,
    scheduleDeletionDayOfWeek: row.settingScheduleDeletionDayOfWeek ?? 0,
    scheduleDeletionTime: row.settingScheduleDeletionTime ?? "09:00",
  };
}

export async function getAccountScheduleSettings(
  accountId: number
): Promise<AccountScheduleSettings> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ScheduleSettingsRow>(
    `SELECT
       b.settingScheduleDeletion,
       b.settingScheduleDeletionFrequency,
       b.settingScheduleDeletionDayOfMonth,
       b.settingScheduleDeletionDayOfWeek,
       b.settingScheduleDeletionTime
     FROM bsky_account b
     INNER JOIN account a ON a.bskyAccountID = b.id
     WHERE a.id = ?
     LIMIT 1;`,
    [accountId]
  );

  if (!row) {
    throw new Error("Unable to load schedule settings for this account");
  }

  return mapRowToSettings(row);
}

export async function updateAccountScheduleSettings(
  accountId: number,
  settings: AccountScheduleSettings
): Promise<void> {
  const db = await getDatabase();
  const accountRow = await db.getFirstAsync<{ bskyAccountID: number }>(
    `SELECT bskyAccountID FROM account WHERE id = ? LIMIT 1;`,
    [accountId]
  );

  if (!accountRow?.bskyAccountID) {
    throw new Error("Unable to find Bluesky account for these settings");
  }

  await db.runAsync(
    `UPDATE bsky_account
     SET settingScheduleDeletion = ?,
         settingScheduleDeletionFrequency = ?,
         settingScheduleDeletionDayOfMonth = ?,
         settingScheduleDeletionDayOfWeek = ?,
         settingScheduleDeletionTime = ?,
         updatedAt = ?
     WHERE id = ?;`,
    [
      settings.scheduleDeletion ? 1 : 0,
      settings.scheduleDeletionFrequency,
      settings.scheduleDeletionDayOfMonth,
      settings.scheduleDeletionDayOfWeek,
      settings.scheduleDeletionTime,
      Date.now(),
      accountRow.bskyAccountID,
    ]
  );
}
