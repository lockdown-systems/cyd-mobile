import { Directory, File, FileMode } from "expo-file-system";
import {
  defaultDatabaseDirectory,
  openDatabaseSync,
  type SQLiteDatabase,
} from "expo-sqlite";
import { createHash } from "react-native-quick-crypto";

import { requireStagedFilePath } from "@/services/archive-import/entry-paths";
import {
  ARCHIVE_EXPORT_DIRECTORY,
  getArchiveExportStagingRoot,
} from "@/services/device-storage";

import type { BlueskyArchiveExportStaging } from "./checkpoint";
import type {
  BlueskyArchiveExportEnvironment,
  ExportStagingArea,
  Hasher,
  ReadableDatabase,
  StagedFileWriter,
  WritableDatabase,
} from "./ports";

/**
 * The device-backed implementation of the export ports.
 *
 * Everything platform-specific about writing a Cyd Bluesky archive lives here:
 * SQLite handles, file handles, hashing, and pausing the account's own jobs.
 * The export logic itself never sees any of it, which is what lets the same
 * writer run under Node against a pulled account directory (ADR 0016).
 */

/** How much of a file to read at a time while hashing or packaging. */
const READ_CHUNK_BYTES = 256 * 1024;

/**
 * expo-sqlite wants a plain directory path, while the file APIs want a
 * `file://` URI. Staging keeps both forms of the same location.
 */
function nativeStagingRoot(): string {
  const sqliteDirectory = (defaultDatabaseDirectory as string).replace(/\/+$/, "");
  const parent = sqliteDirectory.slice(0, sqliteDirectory.lastIndexOf("/"));
  return `${parent}/${ARCHIVE_EXPORT_DIRECTORY}`;
}

class DeviceExportStagingArea implements ExportStagingArea {
  readonly root: string;
  readonly nativeRoot: string;

  constructor(exportId: string) {
    this.root = `${getArchiveExportStagingRoot()}${exportId}/`;
    this.nativeRoot = `${nativeStagingRoot()}/${exportId}`;
    new Directory(this.root).create({ intermediates: true, idempotent: true });
  }

  createFile(relativePath: string): StagedFileWriter {
    const file = new File(this.locate(relativePath));
    file.create({ intermediates: true, overwrite: true });
    const handle = file.open(FileMode.Truncate);
    return {
      write: (chunk) => handle.writeBytes(chunk),
      close: () => handle.close(),
    };
  }

  locate(relativePath: string): string {
    return `${this.root}${requireStagedFilePath(relativePath)}`;
  }

  /** The same staged file, named the way expo-sqlite expects. */
  locateNative(relativePath: string): { directory: string; name: string } {
    const safePath = requireStagedFilePath(relativePath);
    const separator = safePath.lastIndexOf("/");
    return separator === -1
      ? { directory: this.nativeRoot, name: safePath }
      : {
          directory: `${this.nativeRoot}/${safePath.slice(0, separator)}`,
          name: safePath.slice(separator + 1),
        };
  }

  fileExists(relativePath: string): boolean {
    return new File(this.locate(relativePath)).exists;
  }

  readText(relativePath: string): string | null {
    const file = new File(this.locate(relativePath));
    return file.exists ? file.textSync() : null;
  }

  writeText(relativePath: string, contents: string): void {
    const file = new File(this.locate(relativePath));
    file.create({ intermediates: true, overwrite: true });
    file.write(contents);
  }

  destroy(): void {
    const directory = new Directory(this.root);
    if (directory.exists) {
      directory.delete();
    }
  }
}

function requireDeviceStaging(staging: ExportStagingArea): DeviceExportStagingArea {
  if (!(staging instanceof DeviceExportStagingArea)) {
    throw new Error("This export environment only works with its own staging area.");
  }
  return staging;
}

function asReadableDatabase(database: SQLiteDatabase): ReadableDatabase {
  return {
    all: <T,>(sql: string) => database.getAllSync<T>(sql),
    close: () => database.closeSync(),
  };
}

function asWritableDatabase(database: SQLiteDatabase): WritableDatabase {
  return {
    exec: (sql) => database.execSync(sql),
    run: (sql, params) => {
      database.runSync(sql, params as never[]);
    },
    close: () => database.closeSync(),
  };
}

export type DeviceExportEnvironmentOptions = {
  /** The live account database this export copies from. */
  accountDatabase: SQLiteDatabase;
  /**
   * Stop and restart the account's own save and delete work.
   *
   * Pausing is what keeps the database copy and the media inventory describing
   * one instant. `VACUUM INTO` would give a consistent database either way —
   * SQLite sees only committed state — but without the pause a job could add
   * media between the copy and the inventory, and the archive would claim an
   * asset its own database never mentioned.
   */
  pauseAccountWork: () => void;
  resumeAccountWork: () => void;
};

/**
 * The staging half of the environment, which needs no account.
 *
 * Reporting what an interrupted export left behind, and throwing it away, are
 * the two things Cyd does about exports outside an export.
 */
export function createBlueskyArchiveExportStaging(): BlueskyArchiveExportStaging {
  return {
    openStaging: (exportId) => new DeviceExportStagingArea(exportId),

    listStagingIds: () => {
      const root = new Directory(getArchiveExportStagingRoot());
      if (!root.exists) {
        return [];
      }
      return root
        .list()
        .filter((item): item is Directory => item instanceof Directory)
        .map((item) => item.name);
    },
  };
}

export function createBlueskyArchiveExportEnvironment(
  options: DeviceExportEnvironmentOptions,
): BlueskyArchiveExportEnvironment {
  const openStaged = (
    staging: ExportStagingArea,
    relativePath: string,
  ): SQLiteDatabase => {
    const { directory, name } = requireDeviceStaging(staging).locateNative(
      relativePath,
    );
    return openDatabaseSync(name, {}, directory);
  };

  return {
    ...createBlueskyArchiveExportStaging(),

    async withAccountWorkPaused(work) {
      options.pauseAccountWork();
      try {
        return await work();
      } finally {
        options.resumeAccountWork();
      }
    },

    async snapshotAccountDatabase(staging, relativePath) {
      const device = requireDeviceStaging(staging);
      const { directory, name } = device.locateNative(relativePath);
      new Directory(`${device.root}`).create({
        intermediates: true,
        idempotent: true,
      });
      const existing = new File(device.locate(relativePath));
      if (existing.exists) {
        existing.delete();
      }
      await options.accountDatabase.runAsync("VACUUM INTO ?;", [
        `${directory}/${name}`,
      ]);
    },

    openSnapshot: (staging, relativePath) =>
      asReadableDatabase(openStaged(staging, relativePath)),

    createBlueskyInterchangeDatabase: (staging, relativePath) => {
      const existing = new File(requireDeviceStaging(staging).locate(relativePath));
      if (existing.exists) {
        existing.delete();
      }
      return asWritableDatabase(openStaged(staging, relativePath));
    },

    statFile: (location) => {
      const file = new File(location);
      return file.exists ? { byteLength: file.size ?? 0 } : null;
    },

    async readFile(location, onBytes) {
      const file = new File(location);
      const handle = file.open(FileMode.ReadOnly);
      try {
        const total = handle.size ?? file.size ?? 0;
        let offset = 0;
        while (offset < total) {
          handle.offset = offset;
          const chunk = handle.readBytes(Math.min(READ_CHUNK_BYTES, total - offset));
          if (chunk.length === 0) {
            break;
          }
          onBytes(chunk);
          offset += chunk.length;
        }
      } finally {
        handle.close();
      }
    },

    createHasher: (): Hasher => {
      const hash = createHash("sha256");
      return {
        update: (chunk) => {
          hash.update(chunk);
        },
        digestHex: () => hash.digest("hex"),
      };
    },

    now: () => new Date(),
  };
}
