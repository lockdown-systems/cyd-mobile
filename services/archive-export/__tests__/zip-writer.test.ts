import { crc32 } from "@/services/archive-import/crc32";
import {
  readZipCentralDirectory,
  streamZipEntry,
} from "@/services/archive-import/zip-reader";
import {
  createMemoryByteReader,
  createTestBlueskyArchiveIntakeEnvironment,
} from "@/testUtils/archiveFixtures";

import { BlueskyArchiveZipWriter, type ArchiveByteSink } from "../zip-writer";

function createMemorySink(): ArchiveByteSink & { bytes(): Uint8Array; closed: boolean } {
  const chunks: Uint8Array[] = [];
  const sink = {
    closed: false,
    write(chunk: Uint8Array): void {
      chunks.push(chunk.slice());
    },
    close(): void {
      sink.closed = true;
    },
    bytes(): Uint8Array {
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      return joined;
    },
  };
  return sink;
}

const encoder = new TextEncoder();

async function readBack(bytes: Uint8Array) {
  const environment = createTestBlueskyArchiveIntakeEnvironment();
  const reader = createMemoryByteReader(bytes);
  const directory = await readZipCentralDirectory(reader, { maxEntries: 64 });
  const contents = new Map<string, string>();
  for (const entry of directory.entries) {
    const chunks: Uint8Array[] = [];
    await streamZipEntry(reader, entry, {
      createDecompressor: environment.createDecompressor,
      createHasher: environment.createHasher,
      onBytes: (chunk) => chunks.push(chunk.slice()),
    });
    contents.set(
      entry.path,
      chunks.map((chunk) => new TextDecoder().decode(chunk)).join(""),
    );
  }
  return { directory, contents };
}

async function writeArchive(
  entries: { path: string; data: string }[],
): Promise<Uint8Array> {
  const sink = createMemorySink();
  const writer = new BlueskyArchiveZipWriter(sink);
  for (const entry of entries) {
    const bytes = encoder.encode(entry.data);
    await writer.addStoredEntry(
      entry.path,
      { byteLength: bytes.length, crc32: crc32(bytes) },
      async (push) => {
        push(bytes);
      },
    );
  }
  writer.finish();
  return sink.bytes();
}

describe("BlueskyArchiveZipWriter", () => {
  it("writes an archive Cyd's own archive reader can read back", async () => {
    const bytes = await writeArchive([
      { path: "data.db", data: "SQLite format 3\u0000stand-in" },
      {
        path: "media/sha256/ab/abababababababababababababababababababababababababababababababab",
        data: "media bytes",
      },
      { path: "metadata.json", data: '{"format":"cyd-archive"}' },
    ]);

    const { directory, contents } = await readBack(bytes);

    expect(directory.entries.map((entry) => entry.path)).toEqual([
      "data.db",
      "media/sha256/ab/abababababababababababababababababababababababababababababababab",
      "metadata.json",
    ]);
    expect(contents.get("metadata.json")).toBe('{"format":"cyd-archive"}');
    expect(
      contents.get(
        "media/sha256/ab/abababababababababababababababababababababababababababababababab",
      ),
    ).toBe("media bytes");
  });

  it("stores entries uncompressed so writing never has to buffer one whole", async () => {
    const bytes = await writeArchive([{ path: "data.db", data: "payload" }]);

    const { directory } = await readBack(bytes);

    expect(directory.entries[0].method).toBe(0);
    expect(directory.entries[0].compressedBytes).toBe(
      directory.entries[0].uncompressedBytes,
    );
  });

  it("streams an entry across as many chunks as the source produces", async () => {
    const sink = createMemorySink();
    const writer = new BlueskyArchiveZipWriter(sink);
    const payload = encoder.encode("one two three");
    await writer.addStoredEntry(
      "data.db",
      { byteLength: payload.length, crc32: crc32(payload) },
      async (push) => {
        push(payload.slice(0, 4));
        push(payload.slice(4, 9));
        push(payload.slice(9));
      },
    );
    writer.finish();

    const { contents } = await readBack(sink.bytes());
    expect(contents.get("data.db")).toBe("one two three");
  });

  it("marks entries as regular files, which a reader is entitled to require", async () => {
    const bytes = await writeArchive([{ path: "data.db", data: "payload" }]);

    // The central directory's external attributes carry the Unix mode in their
    // high 16 bits. conformance.py rejects anything that is not a regular file.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let centralHeaderOffset = -1;
    for (let offset = 0; offset < bytes.length - 4; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        centralHeaderOffset = offset;
        break;
      }
    }
    expect(centralHeaderOffset).toBeGreaterThan(-1);
    const externalAttributes = view.getUint32(centralHeaderOffset + 38, true);
    expect((externalAttributes >>> 16) & 0o170000).toBe(0o100000);
  });

  it("refuses an entry that does not produce the byte count it declared", async () => {
    const writer = new BlueskyArchiveZipWriter(createMemorySink());

    await expect(
      writer.addStoredEntry("data.db", { byteLength: 12, crc32: 0 }, async (push) => {
        push(encoder.encode("short"));
      }),
    ).rejects.toThrow(/declared 12 bytes/);
  });

  it("refuses an entry whose bytes do not match the checksum it declared", async () => {
    const payload = encoder.encode("payload");
    const writer = new BlueskyArchiveZipWriter(createMemorySink());

    await expect(
      writer.addStoredEntry(
        "data.db",
        { byteLength: payload.length, crc32: crc32(payload) + 1 },
        async (push) => {
          push(payload);
        },
      ),
    ).rejects.toThrow(/changed while it was being packaged/);
  });

  it("refuses an entry path that could escape the archive", async () => {
    const writer = new BlueskyArchiveZipWriter(createMemorySink());

    await expect(
      writer.addStoredEntry(
        "../escape.json",
        { byteLength: 0, crc32: crc32(new Uint8Array(0)) },
        async () => {},
      ),
    ).rejects.toThrow(/normalized relative file path/);
  });

  it("refuses to add the same path twice", async () => {
    const sink = createMemorySink();
    const writer = new BlueskyArchiveZipWriter(sink);
    const declared = { byteLength: 0, crc32: crc32(new Uint8Array(0)) };
    await writer.addStoredEntry("data.db", declared, async () => {});

    await expect(
      writer.addStoredEntry("data.db", declared, async () => {}),
    ).rejects.toThrow(/more than once/);
  });
});
