import { BlueskyAccountController } from "@/controllers/BlueskyAccountController";

type ManagerEntry = {
  controller: BlueskyAccountController;
  accountUUID: string;
  initPromise: Promise<void>;
  disposePromise: Promise<void> | null;
};

const controllerManager = new Map<number, ManagerEntry>();

function createEntry(accountId: number, accountUUID: string): ManagerEntry {
  console.log("[BlueskyControllerManager] create", accountId, accountUUID);
  const controller = new BlueskyAccountController(accountId, accountUUID);
  return {
    controller,
    accountUUID,
    initPromise: controller.initDB(),
    disposePromise: null,
  };
}

async function disposeEntry(
  accountId: number,
  entry: ManagerEntry,
): Promise<void> {
  console.log("[BlueskyControllerManager] dispose -> requested", accountId);
  if (entry.disposePromise) {
    console.log(
      "[BlueskyControllerManager] dispose -> await in-flight",
      accountId,
    );
    await entry.disposePromise;
    return;
  }

  entry.disposePromise = (async () => {
    try {
      await entry.initPromise.catch(() => undefined);
      console.log("[BlueskyControllerManager] dispose -> cleanup", accountId);
      await entry.controller.cleanup();
    } finally {
      if (controllerManager.get(accountId) === entry) {
        controllerManager.delete(accountId);
      }
      console.log("[BlueskyControllerManager] dispose -> done", accountId);
      entry.disposePromise = null;
    }
  })();

  await entry.disposePromise;
}

export async function getBlueskyController(
  accountId: number,
  accountUUID: string,
): Promise<BlueskyAccountController> {
  while (true) {
    let entry = controllerManager.get(accountId);

    if (!entry) {
      entry = createEntry(accountId, accountUUID);
      controllerManager.set(accountId, entry);
      console.log("[BlueskyControllerManager] get -> new", accountId);
    } else {
      console.log("[BlueskyControllerManager] get -> existing", accountId);
    }

    if (entry.disposePromise) {
      await entry.disposePromise;
      continue;
    }

    if (entry.accountUUID !== accountUUID) {
      console.warn(
        "[BlueskyControllerManager] account UUID mismatch for shared controller",
        accountId,
        { expected: entry.accountUUID, received: accountUUID },
      );
    }

    try {
      await entry.initPromise;
      return entry.controller;
    } catch (err) {
      await disposeEntry(accountId, entry);
      throw err;
    }
  }
}

export async function withBlueskyController<T>(
  accountId: number,
  accountUUID: string,
  fn: (controller: BlueskyAccountController) => Promise<T>,
): Promise<T> {
  const controller = await getBlueskyController(accountId, accountUUID);
  return fn(controller);
}

export async function disposeBlueskyController(
  accountId: number,
): Promise<void> {
  const entry = controllerManager.get(accountId);
  if (!entry) {
    console.log("[BlueskyControllerManager] dispose -> no-op", accountId);
    return;
  }

  await disposeEntry(accountId, entry);
}

export async function deleteBlueskyAccountStorage(
  accountId: number,
  accountUUID: string,
): Promise<void> {
  // Phase 5 sequence: dispose managed singleton first, then delete account data.
  await disposeBlueskyController(accountId);

  const cleanupController = new BlueskyAccountController(
    accountId,
    accountUUID,
  );
  await cleanupController.deleteAccountStorage();
}

export async function disposeAllBlueskyControllersForTests(): Promise<void> {
  const entries = [...controllerManager.entries()];
  for (const [accountId, entry] of entries) {
    await disposeEntry(accountId, entry);
  }
}
