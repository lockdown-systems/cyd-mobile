import { Directory, File, FileMode, Paths } from "expo-file-system";
import { createHash } from "react-native-quick-crypto";

import { getArchiveStagingRoot } from "@/services/device-storage";

import { checkArchiveEntryPath } from "./entry-paths";
import { ArchiveIntakeError } from "./errors";
import { createInflateDecompressor } from "./inflate";
import type {
  ArchiveByteReader,
  ArchiveIntakeEnvironment,
  ArchiveStagingArea,
  Hasher,
  StagedFileWriter,
} from "./ports";

/**
 * The device-backed implementation of the intake ports.
 *
 * Everything platform-specific about Bluesky archive intake lives here: file
 * handles, free space, and hashing. The intake logic itself stays testable
 * because it never sees any of it.
 */

function ensureDirectory(uri: string): Directory {
  const directory = new Directory(uri);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * Resolve a staging-relative path, refusing anything that could leave the
 * staging root. This repeats the ZIP reader's check on purpose: it is the last
 * gate before a real write, and it protects paths that never came from a ZIP.
 */
function resolveStagedUri(root: string, relativePath: string): string {
  const check = checkArchiveEntryPath(relativePath);
  if (!check.ok || check.isDirectory) {
    throw new ArchiveIntakeError(
      "unsafe-entry-path",
      check.ok
        ? `Refusing to write the directory ${relativePath} as a file.`
        : check.reason,
    );
  }
  return `${root}${check.path}`;
}

function parentDirectoryUri(uri: string): string {
  return uri.slice(0, uri.lastIndexOf("/") + 1);
}

class DeviceStagingArea implements ArchiveStagingArea {
  readonly root: string;

  constructor(intakeId: string) {
    this.root = `${getArchiveStagingRoot()}${intakeId}/`;
    ensureDirectory(this.root);
  }

  createFile(relativePath: string): StagedFileWriter {
    const uri = resolveStagedUri(this.root, relativePath);
    ensureDirectory(parentDirectoryUri(uri));

    const file = new File(uri);
    file.create({ intermediates: true, overwrite: true });
    const handle = file.open(FileMode.Truncate);
    return {
      write: (chunk) => handle.writeBytes(chunk),
      close: () => handle.close(),
    };
  }

  fileExists(relativePath: string): boolean {
    return new File(resolveStagedUri(this.root, relativePath)).exists;
  }

  fileSize(relativePath: string): number | null {
    const file = new File(resolveStagedUri(this.root, relativePath));
    return file.exists ? file.size : null;
  }

  readText(relativePath: string): string | null {
    const file = new File(resolveStagedUri(this.root, relativePath));
    return file.exists ? file.textSync() : null;
  }

  writeText(relativePath: string, contents: string): void {
    const file = new File(resolveStagedUri(this.root, relativePath));
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

const createDeviceHasher = (): Hasher => {
  const hash = createHash("sha256");
  return {
    update: (chunk) => {
      hash.update(chunk);
    },
    digestHex: () => hash.digest("hex"),
  };
};

/** Open the archive the person picked for random-access reads. */
export function openArchiveByteReader(uri: string): ArchiveByteReader {
  const file = new File(uri);
  if (!file.exists) {
    throw new ArchiveIntakeError(
      "not-an-archive",
      "That file is no longer available on this device.",
    );
  }
  const handle = file.open(FileMode.ReadOnly);
  return {
    byteLength: handle.size ?? file.size,
    async read(offset: number, length: number): Promise<Uint8Array> {
      handle.offset = offset;
      return handle.readBytes(length);
    },
    close(): void {
      handle.close();
    },
  };
}

export function createArchiveIntakeEnvironment(): ArchiveIntakeEnvironment {
  return {
    openStaging: (intakeId) => new DeviceStagingArea(intakeId),
    listStagingIds: () => {
      const root = new Directory(getArchiveStagingRoot());
      if (!root.exists) {
        return [];
      }
      return root
        .list()
        .filter((item): item is Directory => item instanceof Directory)
        .map((item) => item.name);
    },
    availableStorageBytes: () => Paths.availableDiskSpace,
    createHasher: createDeviceHasher,
    createDecompressor: createInflateDecompressor,
    now: () => new Date(),
  };
}
