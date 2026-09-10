import {
  buildZip,
  createMemoryByteReader,
  createNodeHasher,
  sha256Hex,
  type ZipEntryInput,
} from "@/testUtils/archiveFixtures";

import { crc32 } from "../crc32";
import { BlueskyArchiveIntakeError } from "../errors";
import { createInflateDecompressor } from "../inflate";
import { readZipCentralDirectory, streamZipEntry } from "../zip-reader";

const LIMITS = { maxEntries: 1000 };

function readDirectory(entries: ZipEntryInput[], options?: { entryCount?: number }) {
  return readZipCentralDirectory(
    createMemoryByteReader(buildZip(entries, options)),
    LIMITS,
  );
}

async function expectRejection(
  promise: Promise<unknown>,
  code: string,
): Promise<BlueskyArchiveIntakeError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BlueskyArchiveIntakeError);
    expect((error as BlueskyArchiveIntakeError).code).toBe(code);
    return error as BlueskyArchiveIntakeError;
  }
  throw new Error(`Expected the archive to be rejected with ${code}`);
}

describe("reading the central directory", () => {
  it("describes each entry without reading its contents", async () => {
    const directory = await readDirectory([
      { name: "metadata.json", data: "{}" },
      { name: "data.db", data: "sqlite", method: 0 },
    ]);

    expect(directory.entries.map((entry) => entry.path)).toEqual([
      "metadata.json",
      "data.db",
    ]);
    expect(directory.entries[1]).toMatchObject({
      method: 0,
      compressedBytes: 6,
      uncompressedBytes: 6,
      crc32: crc32(new TextEncoder().encode("sqlite")),
    });
    expect(directory.totalUncompressedBytes).toBe(8);
  });

  it("finds the directory even when the archive has a trailing comment", async () => {
    const directory = await readDirectory([{ name: "data.db", data: "x" }], {
      entryCount: 1,
    });
    expect(directory.entries).toHaveLength(1);

    const commented = await readZipCentralDirectory(
      createMemoryByteReader(
        buildZip([{ name: "data.db", data: "x" }], { comment: "renamed by hand" }),
      ),
      LIMITS,
    );
    expect(commented.entries).toHaveLength(1);
  });

  it("does not offer directory entries as files to unpack", async () => {
    const directory = await readDirectory([
      { name: "media/", data: "" },
      { name: "media/blob", data: "hello" },
    ]);

    expect(directory.entries.map((entry) => entry.path)).toEqual(["media/blob"]);
  });

  it("rejects a file that is not a ZIP at all", async () => {
    await expectRejection(
      readZipCentralDirectory(
        createMemoryByteReader(new TextEncoder().encode("not a zip file at all")),
        LIMITS,
      ),
      "not-an-archive",
    );
  });

  it("rejects entry paths that would escape the staging area", async () => {
    await expectRejection(
      readDirectory([{ name: "../../evil.db", data: "x" }]),
      "unsafe-entry-path",
    );
    await expectRejection(
      readDirectory([{ name: "/etc/passwd", data: "x" }]),
      "unsafe-entry-path",
    );
    await expectRejection(
      readDirectory([{ name: "media\\..\\evil", data: "x" }]),
      "unsafe-entry-path",
    );
  });

  it("rejects symlink entries", async () => {
    await expectRejection(
      readDirectory([
        {
          name: "media/link",
          data: "../../../../etc/passwd",
          externalAttributes: 0xa1ff << 16,
          versionMadeByHost: 3,
        },
      ]),
      "unsupported-entry-type",
    );
  });

  it("rejects entries that are neither files nor directories", async () => {
    await expectRejection(
      readDirectory([
        { name: "device", data: "", externalAttributes: 0x21b6 << 16 },
      ]),
      "unsupported-entry-type",
    );
  });

  it("rejects duplicate entries, including case-only duplicates", async () => {
    await expectRejection(
      readDirectory([
        { name: "metadata.json", data: "{}" },
        { name: "metadata.json", data: "{\"evil\":true}" },
      ]),
      "duplicate-entry",
    );
    await expectRejection(
      readDirectory([
        { name: "metadata.json", data: "{}" },
        { name: "Metadata.JSON", data: "{}" },
      ]),
      "duplicate-entry",
    );
  });

  it("rejects archives with more entries than Cyd will read", async () => {
    await expectRejection(
      readZipCentralDirectory(
        createMemoryByteReader(
          buildZip([
            { name: "a", data: "a" },
            { name: "b", data: "b" },
          ]),
        ),
        { maxEntries: 1 },
      ),
      "too-many-entries",
    );
  });

  it("rejects an entry count that disagrees with the directory", async () => {
    await expectRejection(
      readDirectory([{ name: "data.db", data: "x" }], { entryCount: 2 }),
      "not-an-archive",
    );
  });

  it("rejects encrypted entries", async () => {
    await expectRejection(
      readDirectory([{ name: "data.db", data: "x", generalPurposeFlags: 0x0801 }]),
      "unsupported-zip-feature",
    );
  });

  it("rejects stored entries whose declared sizes disagree", async () => {
    await expectRejection(
      readDirectory([
        { name: "data.db", data: "sqlite", method: 0, uncompressedBytes: 99 },
      ]),
      "size-mismatch",
    );
  });
});

describe("streaming an entry", () => {
  async function streamAll(
    entries: ZipEntryInput[],
    path: string,
  ): Promise<{ bytes: Uint8Array; sha256: string }> {
    const zip = buildZip(entries);
    const reader = createMemoryByteReader(zip);
    const directory = await readZipCentralDirectory(reader, LIMITS);
    const entry = directory.entries.find((candidate) => candidate.path === path);
    if (!entry) {
      throw new Error(`No entry named ${path}`);
    }
    const chunks: Uint8Array[] = [];
    const result = await streamZipEntry(reader, entry, {
      createDecompressor: createInflateDecompressor,
      createHasher: createNodeHasher,
      onBytes: (bytes) => chunks.push(bytes.slice()),
    });
    return { bytes: Buffer.concat(chunks), sha256: result.sha256 };
  }

  it("returns deflated content and its digest", async () => {
    const content = "a".repeat(10_000);
    const streamed = await streamAll([{ name: "data.db", data: content }], "data.db");

    expect(new TextDecoder().decode(streamed.bytes)).toBe(content);
    expect(streamed.sha256).toBe(sha256Hex(content));
  });

  it("returns stored content and its digest", async () => {
    const streamed = await streamAll(
      [{ name: "metadata.json", data: "{}", method: 0 }],
      "metadata.json",
    );

    expect(new TextDecoder().decode(streamed.bytes)).toBe("{}");
    expect(streamed.sha256).toBe(sha256Hex("{}"));
  });

  it("handles empty entries", async () => {
    const streamed = await streamAll([{ name: "empty", data: "" }], "empty");
    expect(streamed.bytes).toHaveLength(0);
    expect(streamed.sha256).toBe(sha256Hex(""));
  });

  it("stops an entry that expands past its declared size", async () => {
    await expectRejection(
      streamAll(
        [{ name: "bomb", data: "\0".repeat(1_000_000), uncompressedBytes: 10 }],
        "bomb",
      ),
      "size-mismatch",
    );
  });

  it("rejects an entry that is smaller than it declares", async () => {
    await expectRejection(
      streamAll([{ name: "short", data: "abc", uncompressedBytes: 4096 }], "short"),
      "size-mismatch",
    );
  });

  it("rejects an entry whose contents do not match its checksum", async () => {
    await expectRejection(
      streamAll([{ name: "data.db", data: "sqlite", crc32: 0x12345678 }], "data.db"),
      "corrupt-archive",
    );
  });

  it("rejects a local header that names a different entry", async () => {
    await expectRejection(
      streamAll(
        [{ name: "metadata.json", data: "{}", localName: "somethingelse.json" }],
        "metadata.json",
      ),
      "corrupt-archive",
    );
  });
});
