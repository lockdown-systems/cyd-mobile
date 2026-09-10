import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  BlueskyArchiveExportEnvironment,
  ExportStagingArea,
  ReadableDatabase,
  WritableDatabase,
} from "@/services/archive-export";

/**
 * The Cyd Bluesky archive export ports, backed by Node instead of a phone.
 *
 * ADR 0016 says Mobile's real-data fixtures are produced by exporting a
 * curated test account *through Mobile's own writer*. This is what makes that
 * possible without a device round trip for every fix: the writer, the
 * translation, and the packaging are the same code the app runs, and only the
 * four things a phone does differently — SQLite, files, hashing, and pausing
 * account work — are supplied from here.
 *
 * It works on a copy of an account directory pulled off a device, so there is
 * no live account to pause and no way for anything it does to reach one.
 */

export type NodeExportEnvironmentOptions = {
  /** A pulled `accounts/bluesky-<uuid>/` directory: `data.db` and `media/`. */
  accountDirectory: string;
  /** Where export staging directories are created. */
  stagingRoot: string;
  /** Runs after the staging pause, standing in for saving resuming. */
  onAccountWorkResumed?: () => void;
  now?: () => Date;
};

class DirectoryStagingArea implements ExportStagingArea {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  createFile(relativePath: string) {
    const location = this.locate(relativePath);
    fs.mkdirSync(path.dirname(location), { recursive: true });
    const handle = fs.openSync(location, "w");
    return {
      write: (chunk: Uint8Array) => {
        fs.writeSync(handle, chunk);
      },
      close: () => fs.closeSync(handle),
    };
  }

  locate(relativePath: string): string {
    return path.join(this.root, relativePath);
  }

  destroy(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

function asReadableDatabase(database: DatabaseSync): ReadableDatabase {
  return {
    all<T>(sql: string): T[] {
      return database.prepare(sql).all() as T[];
    },
    close: () => database.close(),
  };
}

function asWritableDatabase(database: DatabaseSync): WritableDatabase {
  return {
    exec: (sql) => database.exec(sql),
    run: (sql, params) => {
      database.prepare(sql).run(...(params as never[]));
    },
    close: () => database.close(),
  };
}

export function createNodeBlueskyArchiveExportEnvironment(
  options: NodeExportEnvironmentOptions,
): BlueskyArchiveExportEnvironment {
  const accountDatabase = path.join(options.accountDirectory, "data.db");
  const mediaDirectory = path.join(options.accountDirectory, "media");

  /**
   * Find a file a device recorded by its own absolute path.
   *
   * `media_asset.localPath` is a URI from the phone's filesystem, which does
   * not exist here. Preserved media is content-addressed by filename, so the
   * last path segment is enough to find it in the pulled copy.
   */
  const resolve = (location: string): string => {
    const withoutScheme = location.startsWith("file://")
      ? decodeURI(location.slice("file://".length))
      : location;
    if (fs.existsSync(withoutScheme)) {
      return withoutScheme;
    }
    return path.join(mediaDirectory, path.basename(withoutScheme));
  };

  return {
    openStaging: (exportId) =>
      new DirectoryStagingArea(path.join(options.stagingRoot, exportId)),

    async withAccountWorkPaused(work) {
      const result = await work();
      options.onAccountWorkResumed?.();
      return result;
    },

    async snapshotAccountDatabase(staging, relativePath) {
      const source = new DatabaseSync(accountDatabase, { readOnly: true });
      try {
        const destination = staging.locate(relativePath);
        fs.rmSync(destination, { force: true });
        source.prepare("VACUUM INTO ?").run(destination);
      } finally {
        source.close();
      }
    },

    openSnapshot: (staging, relativePath) =>
      asReadableDatabase(
        new DatabaseSync(staging.locate(relativePath), { readOnly: true }),
      ),

    createBlueskyInterchangeDatabase: (staging, relativePath) => {
      const location = staging.locate(relativePath);
      fs.rmSync(location, { force: true });
      return asWritableDatabase(new DatabaseSync(location));
    },

    statFile: (location) => {
      const resolved = resolve(location);
      return fs.existsSync(resolved)
        ? { byteLength: fs.statSync(resolved).size }
        : null;
    },

    async readFile(location, onBytes) {
      const handle = fs.openSync(resolve(location), "r");
      try {
        const buffer = Buffer.alloc(256 * 1024);
        while (true) {
          const read = fs.readSync(handle, buffer, 0, buffer.length, null);
          if (read === 0) {
            break;
          }
          onBytes(new Uint8Array(buffer.subarray(0, read)));
        }
      } finally {
        fs.closeSync(handle);
      }
    },

    createHasher: () => {
      const hash = crypto.createHash("sha256");
      return {
        update: (chunk) => {
          hash.update(chunk);
        },
        digestHex: () => hash.digest("hex"),
      };
    },

    now: options.now ?? (() => new Date()),
  };
}
