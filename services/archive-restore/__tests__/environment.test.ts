/**
 * The device-backed restore ports, exercised against an in-memory filesystem
 * that behaves like `expo-file-system`.
 *
 * The Node adapter the restore tests use proves the *logic*; these prove the
 * three things only a phone does with files, and that only this file knows how
 * to do: a restored asset lands inside its own Bluesky local account, a
 * committed archive's staging goes away, and discarding a half-restored
 * account takes its media with it.
 */

import * as FileSystem from "expo-file-system";

import { createBlueskyArchiveRestoreEnvironment } from "../environment";

type MockFileSystem = {
  files: Map<string, Uint8Array>;
  directories: Set<string>;
  reset: () => void;
};

jest.mock("expo-file-system", () => {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>(["file:///mock/document/directory/"]);
  const state = {
    files,
    directories,
    reset: () => {
      files.clear();
      directories.clear();
      directories.add("file:///mock/document/directory/");
    },
  };

  class Directory {
    uri: string;

    constructor(uri: string) {
      this.uri = uri.endsWith("/") ? uri : `${uri}/`;
    }

    get exists(): boolean {
      return directories.has(this.uri);
    }

    create(): void {
      const segments = this.uri.replace("file:///", "").split("/").filter(Boolean);
      let current = "file:///";
      for (const segment of segments) {
        current += `${segment}/`;
        directories.add(current);
      }
    }

    delete(): void {
      for (const uri of [...directories]) {
        if (uri.startsWith(this.uri)) {
          directories.delete(uri);
        }
      }
      for (const uri of [...files.keys()]) {
        if (uri.startsWith(this.uri)) {
          files.delete(uri);
        }
      }
    }
  }

  class File {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists(): boolean {
      return files.has(this.uri);
    }

    get size(): number {
      return files.get(this.uri)?.length ?? 0;
    }

    create(): void {
      files.set(this.uri, new Uint8Array(0));
    }

    open(mode: string) {
      if (!files.has(this.uri)) {
        throw new Error(`No such file: ${this.uri}`);
      }
      if (mode === "wt") {
        files.set(this.uri, new Uint8Array(0));
      }
      const handle = {
        offset: 0,
        size: files.get(this.uri)?.length ?? 0,
        readBytes: (length: number): Uint8Array => {
          const contents = files.get(this.uri) ?? new Uint8Array(0);
          const slice = contents.slice(handle.offset, handle.offset + length);
          handle.offset += slice.length;
          return slice;
        },
        writeBytes: (chunk: Uint8Array): void => {
          const contents = files.get(this.uri) ?? new Uint8Array(0);
          const combined = new Uint8Array(contents.length + chunk.length);
          combined.set(contents, 0);
          combined.set(chunk, contents.length);
          files.set(this.uri, combined);
        },
        close: (): void => {},
      };
      return handle;
    }
  }

  return {
    Directory,
    File,
    FileMode: { ReadOnly: "r", Truncate: "wt" },
    Paths: {
      document: { uri: "file:///mock/document/directory/" },
      availableDiskSpace: 64 * 1024 * 1024 * 1024,
    },
    __state: state,
  };
});

jest.mock("expo-sqlite", () => ({
  defaultDatabaseDirectory: "/mock/document/directory/SQLite",
  openDatabaseAsync: jest.fn(),
}));

jest.mock("@/database", () => ({ getDatabase: jest.fn() }));
jest.mock("@/database/accounts", () => ({
  createBlueskyAccount: jest.fn(),
  deleteAccount: jest.fn(),
  listAccounts: jest.fn(async () => []),
}));

const mockFileSystem = (FileSystem as unknown as { __state: MockFileSystem })
  .__state;

const ACCOUNT_UUID = "b67bfc6c-6155-47ef-8273-71593e04f01a";
const ACCOUNT_DIRECTORY = `file:///mock/document/directory/accounts/bluesky-${ACCOUNT_UUID}/`;
const STAGING_ROOT = "file:///mock/document/directory/archive-intake/intake-1/";

beforeEach(() => {
  mockFileSystem.reset();
});

describe("the device-backed restore ports", () => {
  it("writes a restored asset inside the account it belongs to", async () => {
    const environment = createBlueskyArchiveRestoreEnvironment();

    const stored = await environment.storeAccountMedia(
      ACCOUNT_UUID,
      "sha256-abc",
      async (push) => {
        push(new Uint8Array([1, 2, 3]));
        push(new Uint8Array([4, 5]));
      },
    );

    expect(stored).toEqual({
      uri: `${ACCOUNT_DIRECTORY}media/sha256-abc`,
      byteLength: 5,
    });
    expect(mockFileSystem.files.get(stored.uri)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5]),
    );
  });

  it("streams a staged payload back out of intake's staging", async () => {
    const payload = `${STAGING_ROOT}payload/media/sha256/ab/abc`;
    mockFileSystem.files.set(payload, new Uint8Array([9, 8, 7]));
    const environment = createBlueskyArchiveRestoreEnvironment();

    const chunks: Uint8Array[] = [];
    await environment
      .openPreparedArchive({ intakeId: "intake-1", stagingRoot: STAGING_ROOT })
      .readPayload("media/sha256/ab/abc", (bytes) => chunks.push(bytes));

    expect(chunks).toEqual([new Uint8Array([9, 8, 7])]);
  });

  it("clears the staging of an archive it has committed", async () => {
    mockFileSystem.directories.add(STAGING_ROOT);
    mockFileSystem.files.set(`${STAGING_ROOT}intake.json`, new Uint8Array([1]));
    const environment = createBlueskyArchiveRestoreEnvironment();

    await environment
      .openPreparedArchive({ intakeId: "intake-1", stagingRoot: STAGING_ROOT })
      .discard();

    expect(mockFileSystem.directories.has(STAGING_ROOT)).toBe(false);
    expect(mockFileSystem.files.size).toBe(0);
  });

  it("takes a half-restored account's media with it when discarding", async () => {
    const environment = createBlueskyArchiveRestoreEnvironment();
    await environment.storeAccountMedia(ACCOUNT_UUID, "sha256-abc", async (push) =>
      push(new Uint8Array([1])),
    );

    await environment.discardLocalAccount({
      accountId: null,
      accountUuid: ACCOUNT_UUID,
    });

    expect(mockFileSystem.files.size).toBe(0);
    expect(mockFileSystem.directories.has(ACCOUNT_DIRECTORY)).toBe(false);
  });
});
