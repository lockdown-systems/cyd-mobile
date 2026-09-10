import {
  CANONICAL_ARCHIVE_METADATA,
  buildBlueskyArchive,
  createMemoryByteReader,
  createTestBlueskyArchiveIntakeEnvironment,
  sha256Hex,
  type BlueskyArchiveInput,
  type TestBlueskyArchiveIntakeEnvironment,
} from "@/testUtils/archiveFixtures";

import {
  cancelBlueskyArchiveIntake,
  listResumableBlueskyArchiveIntakes,
  runBlueskyArchiveIntake,
  stagedPayloadPath,
  type BlueskyArchiveIntakeProgress,
  type BlueskyArchiveIntakeOutcome,
  type RunBlueskyArchiveIntakeOptions,
} from "../intake";

const INTAKE_ID = "intake-1";

function run(
  environment: TestBlueskyArchiveIntakeEnvironment,
  archive: Uint8Array,
  options: Partial<RunBlueskyArchiveIntakeOptions> = {},
): Promise<BlueskyArchiveIntakeOutcome> {
  return runBlueskyArchiveIntake(environment, {
    intakeId: INTAKE_ID,
    sourceUri: "file:///picked/Cyd-archive.cyd",
    openReader: async () => createMemoryByteReader(archive),
    ...options,
  });
}

function stagingFor(environment: TestBlueskyArchiveIntakeEnvironment) {
  const staging = environment.stagingAreas.get(INTAKE_ID);
  if (!staging) {
    throw new Error("No staging area was opened");
  }
  return staging;
}

async function expectRejection(
  archive: Uint8Array | BlueskyArchiveInput,
  code: string,
): Promise<{ message: string; environment: TestBlueskyArchiveIntakeEnvironment }> {
  const environment = createTestBlueskyArchiveIntakeEnvironment();
  const bytes =
    archive instanceof Uint8Array ? archive : buildBlueskyArchive(archive);
  const outcome = await run(environment, bytes);

  if (outcome.status !== "rejected") {
    throw new Error(`Expected a rejection, got ${outcome.status}`);
  }
  expect(outcome.code).toBe(code);
  expect(stagingFor(environment).destroyed).toBe(true);
  return { message: outcome.message, environment };
}

describe("preparing a valid Bluesky archive", () => {
  it("stages every payload and reports the archive's identity", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const archive = buildBlueskyArchive({
      payloads: [
        { path: "data.db", data: "SQLite format 3 rows" },
        { path: "media/sha256/aa/portrait.jpg", data: "jpeg-bytes" },
      ],
    });

    const outcome = await run(environment, archive);

    expect(outcome).toMatchObject({
      status: "prepared",
      intakeId: INTAKE_ID,
      metadata: CANONICAL_ARCHIVE_METADATA,
    });
    const staging = stagingFor(environment);
    expect(staging.readText(stagedPayloadPath("data.db"))).toBe(
      "SQLite format 3 rows",
    );
    expect(
      staging.readText(stagedPayloadPath("media/sha256/aa/portrait.jpg")),
    ).toBe("jpeg-bytes");
  });

  it("keeps its checkpoint where no archive entry can reach it", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const forgedCheckpoint = JSON.stringify({ phase: "prepared" });
    const archive = buildBlueskyArchive({
      payloads: [
        { path: "data.db", data: "rows" },
        { path: "intake.json", data: forgedCheckpoint },
      ],
    });

    const outcome = await run(environment, archive);

    expect(outcome.status).toBe("prepared");
    const staging = stagingFor(environment);
    expect(staging.readText(stagedPayloadPath("intake.json"))).toBe(
      forgedCheckpoint,
    );
    expect(JSON.parse(staging.readText("intake.json") ?? "{}")).toMatchObject({
      phase: "prepared",
      sourceUri: "file:///picked/Cyd-archive.cyd",
    });
  });

  it("writes nothing outside the staging area", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();

    await run(environment, buildBlueskyArchive());

    expect([...environment.stagingAreas.keys()]).toEqual([INTAKE_ID]);
    for (const path of stagingFor(environment).files.keys()) {
      expect(path.startsWith("payload/") || path === "intake.json").toBe(true);
    }
  });
});

describe("rejecting archives that are not safe to unpack", () => {
  it("rejects an entry that would escape the staging area", async () => {
    const { message } = await expectRejection(
      { unlistedEntries: [{ name: "../../evil.db", data: "x" }] },
      "unsafe-entry-path",
    );
    expect(message).toMatch(/traverses outside/i);
  });

  it("rejects a symlink entry", async () => {
    await expectRejection(
      {
        unlistedEntries: [
          {
            name: "media/link",
            data: "../../../../etc/passwd",
            externalAttributes: 0xa1ff << 16,
          },
        ],
      },
      "unsupported-entry-type",
    );
  });

  it("rejects an entry the manifest does not vouch for", async () => {
    const { message } = await expectRejection(
      { unlistedEntries: [{ name: "extra.db", data: "smuggled" }] },
      "manifest-mismatch",
    );
    expect(message).toMatch(/extra\.db/);
  });

  it("rejects a manifest that promises a payload the archive does not carry", async () => {
    await expectRejection(
      {
        manifest: (manifest) => ({
          ...manifest,
          payloads: [
            ...manifest.payloads,
            { path: "media/missing.jpg", bytes: 3, sha256: sha256Hex("abc") },
          ],
        }),
      },
      "manifest-mismatch",
    );
  });

  it("rejects a manifest whose declared size disagrees with the archive", async () => {
    await expectRejection(
      {
        manifest: (manifest) => ({
          ...manifest,
          payloads: manifest.payloads.map((payload) =>
            payload.path === "data.db" ? { ...payload, bytes: 4 } : payload,
          ),
        }),
      },
      "manifest-mismatch",
    );
  });

  it("rejects a payload whose contents do not match its digest", async () => {
    await expectRejection(
      {
        manifest: (manifest) => ({
          ...manifest,
          payloads: manifest.payloads.map((payload) =>
            payload.path === "data.db"
              ? { ...payload, sha256: sha256Hex("something else entirely") }
              : payload,
          ),
        }),
      },
      "digest-mismatch",
    );
  });

  it("rejects duplicate entries", async () => {
    await expectRejection(
      { unlistedEntries: [{ name: "data.db", data: "second copy" }] },
      "duplicate-entry",
    );
  });

  it("rejects an archive with no manifest", async () => {
    await expectRejection(
      {
        mutateEntries: (entries) =>
          entries.filter((entry) => entry.name !== "manifest.json"),
      },
      "manifest-missing",
    );
  });

  it("rejects an archive with no metadata", async () => {
    await expectRejection(
      {
        mutateEntries: (entries) =>
          entries.filter((entry) => entry.name !== "metadata.json"),
        manifest: (manifest) => ({
          ...manifest,
          payloads: manifest.payloads.filter(
            (payload) => payload.path !== "metadata.json",
          ),
        }),
      },
      "metadata-missing",
    );
  });

  it("rejects the unversioned prototype archive by its contents", async () => {
    const { message } = await expectRejection(
      {
        metadata: {
          type: "bluesky",
          uuid: "018d5f7a-9b3c-7d10-8a2e-1f4c6b8d0e12",
          exportTimestamp: "2026-01-15T12:00:00.000Z",
          account: {},
        },
      },
      "unsupported-archive",
    );
    expect(message).toMatch(/legacy/i);
  });

  it("rejects a newer archive version it cannot read", async () => {
    const { message } = await expectRejection(
      { metadata: { ...CANONICAL_ARCHIVE_METADATA, version: 3 } },
      "unsupported-archive",
    );
    expect(message).toMatch(/newer/i);
  });

  it("rejects a file that is not an archive", async () => {
    await expectRejection(
      new TextEncoder().encode("this is just a text file"),
      "not-an-archive",
    );
  });
});

describe("resource limits", () => {
  it("stops an archive that expands far beyond what it packs", async () => {
    const { message } = await expectRejection(
      { payloads: [{ path: "data.db", data: " ".repeat(20_000_000) }] },
      "expansion-exceeded",
    );
    expect(message).toMatch(/expands/i);
  });

  it("refuses when the device does not have room for the archive", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment({
      availableStorageBytes: 1024,
    });

    const outcome = await run(environment, buildBlueskyArchive());

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "insufficient-storage",
    });
    expect(stagingFor(environment).destroyed).toBe(true);
  });

  it("asks about a large archive instead of rejecting it out of hand", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const archive = buildBlueskyArchive({
      payloads: [{ path: "data.db", data: "video".repeat(2000) }],
    });
    const limits = {
      confirmationThresholdBytes: 1000,
      expansionRatioFloorBytes: 1e9,
    };

    const asked = await run(environment, archive, { limits });

    expect(asked).toMatchObject({
      status: "needs-confirmation",
      reason: "large-archive",
      totalBytes: 10_000 + JSON.stringify(CANONICAL_ARCHIVE_METADATA).length,
    });
    expect(
      stagingFor(environment).fileExists(stagedPayloadPath("data.db")),
    ).toBe(false);

    const confirmed = await run(environment, archive, {
      limits,
      confirmLargeArchive: true,
    });
    expect(confirmed.status).toBe("prepared");
  });

  it("does not ask twice once the person has confirmed", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const archive = buildBlueskyArchive({
      payloads: [{ path: "data.db", data: "video".repeat(2000) }],
    });
    const limits = {
      confirmationThresholdBytes: 1000,
      expansionRatioFloorBytes: 1e9,
    };

    await run(environment, archive, { limits });
    stagingFor(environment).failWrites.add(stagedPayloadPath("data.db"));
    await expect(
      run(environment, archive, { limits, confirmLargeArchive: true }),
    ).rejects.toThrow(/Simulated storage failure/);
    stagingFor(environment).failWrites.clear();

    const resumed = await run(environment, archive, { limits });

    expect(resumed.status).toBe("prepared");
  });
});

describe("running out of room", () => {
  const archive = buildBlueskyArchive({
    payloads: [
      { path: "data.db", data: "rows".repeat(1000) },
      { path: "media/one.jpg", data: "one".repeat(1000) },
    ],
  });
  const limits = { storageHeadroomBytes: 100, expansionRatioFloorBytes: 1e9 };

  async function stagePartially(environment: TestBlueskyArchiveIntakeEnvironment) {
    const staging = environment.openStaging(INTAKE_ID);
    staging.failWrites.add(stagedPayloadPath("media/one.jpg"));
    await expect(run(environment, archive, { limits })).rejects.toThrow();
    staging.failWrites.clear();
    return staging;
  }

  it("asks only for the room the work that is left needs", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const staging = await stagePartially(environment);
    // Enough for the last payload, nowhere near enough for the whole archive.
    environment.availableStorage = 3200;

    const resumed = await run(environment, archive, { limits });

    expect(resumed.status).toBe("prepared");
    expect(staging.readText(stagedPayloadPath("media/one.jpg"))).toBe(
      "one".repeat(1000),
    );
  });

  it("keeps verified payloads when the device is out of room", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const staging = await stagePartially(environment);
    environment.availableStorage = 10;

    const outcome = await run(environment, archive, { limits });

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "insufficient-storage",
    });
    expect(staging.destroyed).toBe(false);
    expect(staging.readText(stagedPayloadPath("data.db"))).toBe(
      "rows".repeat(1000),
    );

    environment.availableStorage = 8 * 1024 * 1024 * 1024;
    expect((await run(environment, archive, { limits })).status).toBe(
      "prepared",
    );
  });

  it("discards an archive it never started staging", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment({
      availableStorageBytes: 10,
    });

    const outcome = await run(environment, archive, { limits });

    expect(outcome).toMatchObject({ code: "insufficient-storage" });
    expect(stagingFor(environment).destroyed).toBe(true);
  });
});

describe("surviving termination", () => {
  const archive = buildBlueskyArchive({
    payloads: [
      { path: "data.db", data: "rows".repeat(100) },
      { path: "media/one.jpg", data: "one".repeat(100) },
      { path: "media/two.jpg", data: "two".repeat(100) },
    ],
  });

  it("resumes without re-staging payloads it already verified", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const staging = environment.openStaging(INTAKE_ID);
    staging.failWrites.add(stagedPayloadPath("media/two.jpg"));

    await expect(run(environment, archive)).rejects.toThrow(
      /Simulated storage failure/,
    );
    const interrupted = listResumableBlueskyArchiveIntakes(environment);
    expect(interrupted).toMatchObject([
      { intakeId: INTAKE_ID, phase: "extracting" },
    ]);
    expect(interrupted[0].preparedBytes).toBeGreaterThan(0);

    staging.failWrites.clear();
    const progress: BlueskyArchiveIntakeProgress[] = [];
    const resumed = await run(environment, archive, {
      onProgress: (update) => progress.push(update),
    });

    expect(resumed.status).toBe("prepared");
    expect(progress[0].preparedBytes).toBe(interrupted[0].preparedBytes);
    expect(staging.readText(stagedPayloadPath("media/two.jpg"))).toBe(
      "two".repeat(100),
    );
  });

  it("restages a payload that was only half written", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const staging = environment.openStaging(INTAKE_ID);
    const halfWritten = stagedPayloadPath("media/two.jpg");
    const createFile = staging.createFile.bind(staging);
    const spy = jest
      .spyOn(staging, "createFile")
      .mockImplementation((relativePath: string) => {
        const writer = createFile(relativePath);
        if (relativePath !== halfWritten) {
          return writer;
        }
        return {
          write: (chunk: Uint8Array) => {
            writer.write(chunk.subarray(0, 2));
            throw new Error("Simulated termination");
          },
          close: () => writer.close(),
        };
      });

    await expect(run(environment, archive)).rejects.toThrow(
      /Simulated termination/,
    );
    expect(staging.readText(halfWritten)).toBe("tw");

    spy.mockRestore();
    const resumed = await run(environment, archive);

    expect(resumed.status).toBe("prepared");
    expect(staging.readText(halfWritten)).toBe("two".repeat(100));
  });

  it("restages a payload that no longer matches the size it was verified at", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const staging = environment.openStaging(INTAKE_ID);
    expect((await run(environment, archive)).status).toBe("prepared");

    // Storage lost the tail of a payload after its checkpoint entry was written.
    staging.files.set(
      stagedPayloadPath("media/one.jpg"),
      new TextEncoder().encode("on"),
    );
    const rerun = await run(environment, archive);

    expect(rerun.status).toBe("prepared");
    expect(staging.readText(stagedPayloadPath("media/one.jpg"))).toBe(
      "one".repeat(100),
    );
  });

  it("starts over when the file behind a resumed import changed", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const staging = environment.openStaging(INTAKE_ID);
    staging.failWrites.add(stagedPayloadPath("media/two.jpg"));
    await expect(run(environment, archive)).rejects.toThrow();

    const different = buildBlueskyArchive({
      payloads: [{ path: "data.db", data: "an entirely different archive" }],
    });
    const outcome = await run(environment, different, {
      openReader: async () => createMemoryByteReader(different),
    });

    expect(outcome.status).toBe("prepared");
    const current = environment.stagingAreas.get(INTAKE_ID);
    expect(current?.fileExists(stagedPayloadPath("media/one.jpg"))).toBe(false);
  });
});

describe("cancellation", () => {
  it("stops part-way through a single large payload", async () => {
    // Stored rather than deflated, so its compressed length is its real length
    // and it has to stream as more than one read.
    const database = "rows".repeat(100_000);
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const archive = buildBlueskyArchive({
      payloads: [{ path: "data.db", data: database }],
      mutateEntries: (entries) =>
        entries.map((entry) =>
          entry.name === "data.db" ? { ...entry, method: 0 as const } : entry,
        ),
    });
    const staging = environment.openStaging(INTAKE_ID);
    let databaseBytesWritten = 0;
    const createFile = staging.createFile.bind(staging);
    jest.spyOn(staging, "createFile").mockImplementation((path: string) => {
      const writer = createFile(path);
      return {
        write: (chunk: Uint8Array) => {
          if (path === stagedPayloadPath("data.db")) {
            databaseBytesWritten += chunk.length;
          }
          writer.write(chunk);
        },
        close: () => writer.close(),
      };
    });
    // data.db is large enough to stream as two reads: metadata.json takes the
    // first check, then data.db is cancelled between its own two chunks.
    let checks = 0;
    const outcome = await run(environment, archive, {
      shouldCancel: () => {
        checks += 1;
        return checks > 2;
      },
    });

    expect(outcome).toEqual({ status: "cancelled", intakeId: INTAKE_ID });
    expect(databaseBytesWritten).toBeGreaterThan(0);
    expect(databaseBytesWritten).toBeLessThan(database.length);
    expect(staging.destroyed).toBe(true);
  });

  it("removes staging when the import is cancelled mid-way", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    const archive = buildBlueskyArchive({
      payloads: [
        { path: "data.db", data: "rows" },
        { path: "media/one.jpg", data: "one" },
      ],
    });
    let checks = 0;

    const outcome = await run(environment, archive, {
      shouldCancel: () => {
        checks += 1;
        return checks > 2;
      },
    });

    expect(outcome).toEqual({ status: "cancelled", intakeId: INTAKE_ID });
    expect(stagingFor(environment).destroyed).toBe(true);
    expect(listResumableBlueskyArchiveIntakes(environment)).toEqual([]);
  });

  it("removes staging when an abandoned import is cancelled later", async () => {
    const environment = createTestBlueskyArchiveIntakeEnvironment();
    await run(environment, buildBlueskyArchive());

    cancelBlueskyArchiveIntake(environment, INTAKE_ID);

    expect(stagingFor(environment).destroyed).toBe(true);
    expect(listResumableBlueskyArchiveIntakes(environment)).toEqual([]);
  });
});
