import { getDatabase } from "./index";

export type CydAccountCredentials = {
  userEmail: string | null;
  deviceToken: string | null;
  deviceUUID: string | null;
};

type CydAccountRow = {
  userEmail: string | null;
  deviceToken: string | null;
  deviceUUID: string | null;
};

export async function getCydAccountCredentials(): Promise<CydAccountCredentials> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CydAccountRow>(
    `SELECT userEmail, deviceToken, deviceUUID FROM cyd_account WHERE id = 1;`
  );

  return {
    userEmail: row?.userEmail ?? null,
    deviceToken: row?.deviceToken ?? null,
    deviceUUID: row?.deviceUUID ?? null,
  };
}

export async function setCydAccountCredentials(
  credentials: Partial<CydAccountCredentials>
): Promise<void> {
  const db = await getDatabase();

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if ("userEmail" in credentials) {
    updates.push("userEmail = ?");
    values.push(credentials.userEmail ?? null);
  }

  if ("deviceToken" in credentials) {
    updates.push("deviceToken = ?");
    values.push(credentials.deviceToken ?? null);
  }

  if ("deviceUUID" in credentials) {
    updates.push("deviceUUID = ?");
    values.push(credentials.deviceUUID ?? null);
  }

  if (updates.length === 0) {
    return;
  }

  updates.push("updatedAt = strftime('%s', 'now')");

  await db.runAsync(
    `UPDATE cyd_account SET ${updates.join(", ")} WHERE id = 1;`,
    values
  );
}

export async function clearCydAccountCredentials(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE cyd_account 
     SET userEmail = NULL, 
         deviceToken = NULL, 
         deviceUUID = NULL,
         updatedAt = strftime('%s', 'now')
     WHERE id = 1;`
  );
}
