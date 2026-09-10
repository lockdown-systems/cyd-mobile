import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runBlueskyArchiveExport } from "@/services/archive-export/export";
import { portableSettingsFromAccountRow } from "@/services/archive-export/portable-settings";

import { createNodeBlueskyArchiveExportEnvironment } from "./node-export-environment";

/**
 * Export a pulled Bluesky account directory as a Cyd Bluesky archive.
 *
 * This is how the committed real-data fixtures are made (ADR 0016). It runs
 * Mobile's own version 2 writer over a copy of a curated test account, so the
 * fixtures carry real facets, CIDs, media bytes, and identifiers rather than
 * anything generated. See `docs/bluesky-archive-fixtures.md`.
 *
 * Usage:
 *   npm run export:archive -- <account-directory> --out <file.cyd> [options]
 *
 *   --out <path>          Where to write the archive. Required.
 *   --main-db <path>      Cyd's main database, for portable settings and DID.
 *   --did <did>           Account DID, if there is no main database to read.
 *   --uuid <uuid>         Account UUID; defaults to the directory's own suffix.
 *   --handle <handle>     Handle, used only to suggest a filename.
 *   --fail-asset <cid>    Mark one asset's download failed for this export, to
 *                         produce the `incomplete` fixture. The change is
 *                         reverted afterwards, and only ever touches the copy.
 */

type Options = {
  accountDirectory: string;
  out: string;
  mainDatabase: string | null;
  did: string | null;
  uuid: string | null;
  handle: string | null;
  failAsset: string | null;
};

function parseOptions(argv: string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("--")) {
      flags.set(argument.slice(2), argv[index + 1] ?? "");
      index += 1;
    } else {
      positional.push(argument);
    }
  }

  const accountDirectory = positional[0];
  const out = flags.get("out");
  if (!accountDirectory || !out) {
    throw new Error(
      "Usage: export-fixture.ts <account-directory> --out <file.cyd> [--main-db <path>] [--did <did>] [--fail-asset <cid>]",
    );
  }

  return {
    accountDirectory: path.resolve(accountDirectory),
    out: path.resolve(out),
    mainDatabase: flags.get("main-db") ? path.resolve(flags.get("main-db")!) : null,
    did: flags.get("did") ?? null,
    uuid: flags.get("uuid") ?? null,
    handle: flags.get("handle") ?? null,
    failAsset: flags.get("fail-asset") ?? null,
  };
}

type AccountIdentity = {
  did: string;
  uuid: string;
  handle: string | null;
  settings: ReturnType<typeof portableSettingsFromAccountRow>;
};

/**
 * Work out who this account is.
 *
 * Cyd keeps identity and settings in its main database rather than in the
 * account directory, so a pulled `main.db` is the best source. Without one,
 * the DID has to be supplied: guessing it from a directory name would put a
 * wrong identity into a fixture every later reader is tested against.
 */
function resolveIdentity(options: Options): AccountIdentity {
  const uuid =
    options.uuid ?? path.basename(options.accountDirectory).replace(/^bluesky-/, "");

  if (!options.mainDatabase) {
    if (!options.did) {
      throw new Error("Pass --main-db or --did so the archive names an identity.");
    }
    return { did: options.did, uuid, handle: options.handle, settings: {} };
  }

  const main = new DatabaseSync(options.mainDatabase, { readOnly: true });
  try {
    const row = main
      .prepare(
        `SELECT b.* FROM bsky_account b
         INNER JOIN account a ON a.bskyAccountID = b.id
         WHERE a.uuid = ? LIMIT 1;`,
      )
      .get(uuid) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`No account with UUID ${uuid} in ${options.mainDatabase}`);
    }
    return {
      did: options.did ?? (row.did as string),
      uuid,
      handle: options.handle ?? ((row.handle as string) ?? null),
      settings: portableSettingsFromAccountRow(row),
    };
  } finally {
    main.close();
  }
}

/**
 * Fail one download for the length of this export.
 *
 * The `incomplete` fixture differs from the `complete` one by a single
 * unavailable asset. Getting there by failing a download, rather than by
 * deleting media or hand-editing the archive, keeps every other record and
 * payload byte-for-byte the same as its complete counterpart.
 */
function withFailedAsset<T>(options: Options, run: () => T): T {
  if (!options.failAsset) {
    return run();
  }

  const database = new DatabaseSync(path.join(options.accountDirectory, "data.db"));
  const previous = database
    .prepare("SELECT downloadState FROM media_asset WHERE contentCid = ?;")
    .get(options.failAsset) as { downloadState: string } | undefined;
  if (!previous) {
    database.close();
    throw new Error(`No media_asset with contentCid ${options.failAsset}`);
  }

  database
    .prepare(
      "UPDATE media_asset SET downloadState = 'failed', lastError = ? WHERE contentCid = ?;",
    )
    .run("Download failed while saving.", options.failAsset);
  database.close();

  try {
    return run();
  } finally {
    const restore = new DatabaseSync(path.join(options.accountDirectory, "data.db"));
    restore
      .prepare(
        "UPDATE media_asset SET downloadState = ?, lastError = NULL WHERE contentCid = ?;",
      )
      .run(previous.downloadState, options.failAsset);
    restore.close();
  }
}

function currentCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const identity = resolveIdentity(options);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cyd-export-fixture-"));

  const result = await withFailedAsset(options, async () => {
    const environment = createNodeBlueskyArchiveExportEnvironment({
      accountDirectory: options.accountDirectory,
      stagingRoot: path.join(workspace, "staging"),
    });
    return runBlueskyArchiveExport(environment, {
      exportId: "fixture",
      accountUuid: identity.uuid,
      accountDid: identity.did,
      accountHandle: identity.handle,
      portableSettings: identity.settings,
      fileName: path.basename(options.out),
      onProgress: (progress) =>
        process.stderr.write(
          `\r${progress.phase.padEnd(12)} ${progress.packagedPayloads}/${progress.totalPayloads} payloads`,
        ),
    });
  });

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.copyFileSync(result.location, options.out);
  result.staging.destroy();
  fs.rmSync(workspace, { recursive: true, force: true });

  const kib = (result.byteLength / 1024).toFixed(1);
  process.stderr.write("\r".padEnd(60) + "\r");
  console.log(`Wrote ${options.out} (${kib} KiB)`);
  console.log(`  completeness  ${result.metadata.completeness}`);
  console.log(
    `  assets        ${result.assets.available} available, ` +
      `${result.assets.missing} missing, ${result.assets.unavailable} unavailable`,
  );
  console.log("");
  console.log("Provenance, for docs/bluesky-archive-fixtures.md:");
  console.log(`  account       ${identity.handle ?? "(unknown handle)"} (${identity.did})`);
  console.log(`  uuid          ${identity.uuid}`);
  console.log(`  exported      ${result.metadata.createdAt}`);
  console.log(`  cyd-mobile    ${currentCommit()}`);
  console.log("");
  console.log(`Check it against the pinned contract before committing it:`);
  console.log(`  npm run check:archive-conformance -- ${options.out}`);

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
