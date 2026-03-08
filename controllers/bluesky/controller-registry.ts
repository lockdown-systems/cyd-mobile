import { BlueskyAccountController } from "@/controllers/BlueskyAccountController";

type RegistryEntry = {
  controller: BlueskyAccountController;
  accountUUID: string;
  refCount: number;
  initPromise: Promise<void>;
  cleanupPromise: Promise<void> | null;
};

export type BlueskyControllerLease = {
  controller: BlueskyAccountController;
  release: () => Promise<void>;
};

const controllerRegistry = new Map<number, RegistryEntry>();

function createEntry(accountId: number, accountUUID: string): RegistryEntry {
  console.log(
    "[BlueskyControllerRegistry] createEntry",
    accountId,
    accountUUID,
  );
  const controller = new BlueskyAccountController(accountId, accountUUID);
  const entry: RegistryEntry = {
    controller,
    accountUUID,
    refCount: 0,
    initPromise: controller.initDB(),
    cleanupPromise: null,
  };
  return entry;
}

async function cleanupEntry(
  accountId: number,
  entry: RegistryEntry,
): Promise<void> {
  console.log(
    "[BlueskyControllerRegistry] cleanupEntry -> requested",
    accountId,
    {
      refCount: entry.refCount,
      hasCleanupPromise: Boolean(entry.cleanupPromise),
    },
  );
  if (entry.cleanupPromise) {
    console.log(
      "[BlueskyControllerRegistry] cleanupEntry -> awaiting in-flight cleanup",
      accountId,
    );
    await entry.cleanupPromise;
    return;
  }

  entry.cleanupPromise = (async () => {
    try {
      await entry.initPromise.catch(() => undefined);
      console.log(
        "[BlueskyControllerRegistry] cleanupEntry -> controller.cleanup",
        accountId,
      );
      await entry.controller.cleanup();
    } finally {
      if (controllerRegistry.get(accountId) === entry) {
        controllerRegistry.delete(accountId);
      }
      console.log(
        "[BlueskyControllerRegistry] cleanupEntry -> done",
        accountId,
        { refCount: entry.refCount },
      );
      entry.cleanupPromise = null;
    }
  })();

  await entry.cleanupPromise;
}

export async function acquireBlueskyController(
  accountId: number,
  accountUUID: string,
): Promise<BlueskyControllerLease> {
  while (true) {
    let entry = controllerRegistry.get(accountId);

    if (!entry) {
      entry = createEntry(accountId, accountUUID);
      controllerRegistry.set(accountId, entry);
      console.log(
        "[BlueskyControllerRegistry] acquire -> new entry",
        accountId,
      );
    } else {
      console.log(
        "[BlueskyControllerRegistry] acquire -> existing entry",
        accountId,
        {
          refCount: entry.refCount,
        },
      );
    }

    if (entry.cleanupPromise) {
      await entry.cleanupPromise;
      continue;
    }

    if (entry.accountUUID !== accountUUID) {
      console.warn(
        "[BlueskyControllerRegistry] account UUID mismatch for shared controller",
        accountId,
        { expected: entry.accountUUID, received: accountUUID },
      );
    }

    entry.refCount += 1;
    console.log(
      "[BlueskyControllerRegistry] acquire -> refCount incremented",
      accountId,
      {
        refCount: entry.refCount,
      },
    );

    try {
      await entry.initPromise;
    } catch (err) {
      entry.refCount = Math.max(0, entry.refCount - 1);
      if (entry.refCount === 0) {
        await cleanupEntry(accountId, entry);
      }
      throw err;
    }

    let released = false;
    return {
      controller: entry.controller,
      release: async () => {
        if (released) {
          console.log(
            "[BlueskyControllerRegistry] release -> already released",
            accountId,
          );
          return;
        }
        released = true;

        const currentEntry = controllerRegistry.get(accountId);
        if (!currentEntry) {
          console.log(
            "[BlueskyControllerRegistry] release -> no current entry",
            accountId,
          );
          return;
        }

        // Ignore stale lease releases to avoid mutating refCounts on a newer entry.
        if (currentEntry !== entry) {
          console.warn(
            "[BlueskyControllerRegistry] release -> stale lease ignored",
            accountId,
          );
          return;
        }

        currentEntry.refCount = Math.max(0, currentEntry.refCount - 1);
        console.log(
          "[BlueskyControllerRegistry] release -> refCount decremented",
          accountId,
          {
            refCount: currentEntry.refCount,
          },
        );
        if (currentEntry.refCount === 0) {
          console.log(
            "[BlueskyControllerRegistry] release -> triggering cleanup",
            accountId,
          );
          await cleanupEntry(accountId, currentEntry);
        }
      },
    };
  }
}

export async function withBlueskyController<T>(
  accountId: number,
  accountUUID: string,
  fn: (controller: BlueskyAccountController) => Promise<T>,
): Promise<T> {
  const lease = await acquireBlueskyController(accountId, accountUUID);
  try {
    return await fn(lease.controller);
  } finally {
    await lease.release();
  }
}

export async function resetBlueskyControllerRegistryForTests(): Promise<void> {
  const entries = [...controllerRegistry.entries()];
  for (const [accountId, entry] of entries) {
    await cleanupEntry(accountId, entry);
  }
}
