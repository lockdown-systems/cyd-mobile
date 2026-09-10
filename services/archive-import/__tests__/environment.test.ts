/**
 * The device-backed intake ports, exercised against an in-memory filesystem
 * that behaves like `expo-file-system`. The point of these tests is the last
 * gate before a real write: a staging area must not be able to touch anything
 * outside its own directory.
 */

import crypto from "crypto";
import * as FileSystem from "expo-file-system";

import { ArchiveIntakeError } from "../errors";
import {
  createArchiveIntakeEnvironment,
  openArchiveByteReader,
} from "../environment";

type MockFileSystem = {
  files: Map<string, Uint8Array>;
  directories: Set<string>;
  availableDiskSpace: number;
  reset: () => void;
};

jest.mock("expo-file-system", () => {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>(["file:///mock/document/directory/"]);
  const state = {
    files,
    directories,
    availableDiskSpace: 64 * 1024 * 1024 * 1024,
    reset: () => {
      files.clear();
      directories.clear();
      directories.add("file:///mock/document/directory/");
      state.availableDiskSpace = 64 * 1024 * 1024 * 1024;
    },
  };

  const nameOf = (uri: string): string =>
    uri.replace(/\/$/, "").split("/").pop() ?? "";

  class Directory {
    uri: string;

    constructor(uri: string) {
      this.uri = uri.endsWith("/") ? uri : `${uri}/`;
    }

    get name(): string {
      return nameOf(this.uri);
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

    list(): (Directory | File)[] {
      const children: (Directory | File)[] = [];
      for (const uri of directories) {
        const rest = uri.slice(this.uri.length);
        if (uri.startsWith(this.uri) && uri !== this.uri && rest.split("/").length === 2) {
          children.push(new Directory(uri));
        }
      }
      for (const uri of files.keys()) {
        if (uri.startsWith(this.uri) && !uri.slice(this.uri.length).includes("/")) {
          children.push(new File(uri));
        }
      }
      return children;
    }
  }

  class File {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get name(): string {
      return nameOf(this.uri);
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

    write(contents: string): void {
      files.set(this.uri, new TextEncoder().encode(contents));
    }

    textSync(): string {
      return new TextDecoder().decode(files.get(this.uri) ?? new Uint8Array(0));
    }

    delete(): void {
      files.delete(this.uri);
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
      get availableDiskSpace() {
        return state.availableDiskSpace;
      },
    },
    __state: state,
  };
});

jest.mock("react-native-quick-crypto", () => ({
  createHash: (algorithm: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("crypto") as typeof import("crypto")).createHash(algorithm),
}));

const state = (FileSystem as unknown as { __state: MockFileSystem }).__state;
const STAGING_ROOT = "file:///mock/document/directory/archive-intake/";

beforeEach(() => {
  state.reset();
});

describe("device-backed staging", () => {
  it("stages an import in its own directory under the staging root", () => {
    const staging = createArchiveIntakeEnvironment().openStaging("intake-1");

    expect(staging.root).toBe(`${STAGING_ROOT}intake-1/`);
    expect(state.directories.has(staging.root)).toBe(true);
  });

  it("writes, reads back, and reports staged files", () => {
    const staging = createArchiveIntakeEnvironment().openStaging("intake-1");

    const writer = staging.createFile("payload/media/one.jpg");
    writer.write(new TextEncoder().encode("first "));
    writer.write(new TextEncoder().encode("second"));
    writer.close();
    staging.writeText("intake.json", '{"phase":"extracting"}');

    expect(staging.fileExists("payload/media/one.jpg")).toBe(true);
    expect(staging.fileSize("payload/media/one.jpg")).toBe(12);
    expect(staging.readText("intake.json")).toBe('{"phase":"extracting"}');
    expect(staging.readText("payload/media/missing.jpg")).toBeNull();
  });

  it("refuses to write outside its own directory", () => {
    const staging = createArchiveIntakeEnvironment().openStaging("intake-1");

    for (const path of ["../../evil.db", "/etc/passwd", "payload/../../evil"]) {
      expect(() => staging.createFile(path)).toThrow(ArchiveIntakeError);
    }
    for (const uri of state.files.keys()) {
      expect(uri.startsWith(staging.root)).toBe(true);
    }
  });

  it("removes everything it staged when destroyed", () => {
    const environment = createArchiveIntakeEnvironment();
    const staging = environment.openStaging("intake-1");
    staging.createFile("payload/data.db").close();
    staging.writeText("intake.json", "{}");

    staging.destroy();

    expect(state.files.size).toBe(0);
    expect(environment.listStagingIds()).toEqual([]);
  });

  it("lists the imports left behind by an earlier launch", () => {
    const environment = createArchiveIntakeEnvironment();
    environment.openStaging("intake-1");
    environment.openStaging("intake-2");

    expect(environment.listStagingIds().sort()).toEqual(["intake-1", "intake-2"]);
  });

  it("reports no leftover imports before anything has been staged", () => {
    expect(createArchiveIntakeEnvironment().listStagingIds()).toEqual([]);
  });
});

describe("device-backed capabilities", () => {
  it("reports the free space the device has", () => {
    state.availableDiskSpace = 1234;

    expect(createArchiveIntakeEnvironment().availableStorageBytes()).toBe(1234);
  });

  it("hashes streamed chunks the way SHA-256 does", () => {
    const hasher = createArchiveIntakeEnvironment().createHasher();
    hasher.update(new TextEncoder().encode("one "));
    hasher.update(new TextEncoder().encode("two"));

    expect(hasher.digestHex()).toBe(
      crypto.createHash("sha256").update("one two").digest("hex"),
    );
  });
});

describe("reading a picked archive", () => {
  it("reads any range of the file", async () => {
    const file = new FileSystem.File("file:///picked/archive.cyd");
    file.create();
    file.write("0123456789");

    const reader = openArchiveByteReader("file:///picked/archive.cyd");

    expect(reader.byteLength).toBe(10);
    expect(new TextDecoder().decode(await reader.read(4, 3))).toBe("456");
    expect(new TextDecoder().decode(await reader.read(0, 2))).toBe("01");
    reader.close();
  });

  it("reports a file that is no longer there", () => {
    expect(() => openArchiveByteReader("file:///picked/gone.cyd")).toThrow(
      ArchiveIntakeError,
    );
  });
});
