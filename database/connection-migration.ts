import type { SQLiteDatabase } from "expo-sqlite";

import { getBlueskyConnection } from "@/services/bluesky-connection-store";

type LegacyConnectionRow = {
  uuid: string;
  did: string | null;
  sessionJson: string | null;
};

export async function migrateLegacyBlueskyConnections(
  db: SQLiteDatabase,
): Promise<void> {
  const accounts = await db.getAllAsync<LegacyConnectionRow>(
    `SELECT a.uuid, b.did, b.sessionJson
       FROM account a
       INNER JOIN bsky_account b ON b.id = a.bskyAccountID;`,
  );

  for (const account of accounts) {
    await getBlueskyConnection({
      accountUUID: account.uuid,
      legacyDid: account.did ?? undefined,
      legacyConnection: account.sessionJson,
    });
  }
}
