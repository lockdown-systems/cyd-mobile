import { BlueskyAccountController } from "@/controllers/BlueskyAccountController";
import {
  disposeAllBlueskyControllersForTests,
  getBlueskyController,
  withBlueskyController as withManagedBlueskyController,
} from "./controller-manager";

export type BlueskyControllerLease = {
  controller: BlueskyAccountController;
  release: () => Promise<void>;
  holdWhile: <T>(promise: Promise<T>) => Promise<T>;
};

/**
 * @deprecated Use `getBlueskyController` from controller-manager.
 * This legacy adapter preserves the old lease shape during migration.
 */
export async function acquireBlueskyController(
  accountId: number,
  accountUUID: string,
): Promise<BlueskyControllerLease> {
  const controller = await getBlueskyController(accountId, accountUUID);

  return {
    controller,
    holdWhile: async <T>(promise: Promise<T>): Promise<T> => promise,
    release: async () => {
      // No-op: manager controllers are long-lived and explicitly disposed.
    },
  };
}

/**
 * @deprecated Use `withBlueskyController` from controller-manager directly.
 */
export async function withBlueskyController<T>(
  accountId: number,
  accountUUID: string,
  fn: (controller: BlueskyAccountController) => Promise<T>,
): Promise<T> {
  return withManagedBlueskyController(accountId, accountUUID, fn);
}

/**
 * @deprecated Use `disposeAllBlueskyControllersForTests` from controller-manager.
 */
export async function resetBlueskyControllerRegistryForTests(): Promise<void> {
  await disposeAllBlueskyControllersForTests();
}
