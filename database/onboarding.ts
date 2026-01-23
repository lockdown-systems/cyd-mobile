import { getDatabase } from "./index";

type OnboardingRow = {
  onboardingShown: number;
};

export async function hasOnboardingBeenShown(): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<OnboardingRow>(
    `SELECT onboardingShown FROM cyd_account WHERE id = 1;`,
  );

  return row?.onboardingShown === 1;
}

export async function setOnboardingShown(shown: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE cyd_account 
     SET onboardingShown = ?, 
         updatedAt = strftime('%s', 'now')
     WHERE id = 1;`,
    [shown ? 1 : 0],
  );
}
