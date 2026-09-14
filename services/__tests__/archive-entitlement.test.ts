import fs from "node:fs";
import path from "node:path";

/**
 * Recovery, portability and browsing are free (ADR 0015).
 *
 * Premium governs collection and automation — saving on a schedule, deleting
 * in bulk. It has never governed getting your own data back out, and #91 says
 * so explicitly: export, import and offline Bluesky browse bypass entitlement
 * entirely.
 *
 * That is a guarantee about an *absence*, which is the hardest kind to keep.
 * There is no premium check to assert the shape of; there is only the fact
 * that nothing in these files reaches for one, and a paywall added a year from
 * now would be a one-line change nobody noticed. So the absence is asserted
 * directly, over the whole surface it has to hold across.
 *
 * The behavioural half lives beside the flows it belongs to: the export card
 * and the import hook are both driven with no `CydAccountProvider` above them,
 * and `useCydAccount` throws outside one, so an entitlement check anywhere in
 * either would fail those tests rather than this one.
 */

const REPOSITORY_ROOT = path.join(__dirname, "../..");

/** How Cyd asks whether somebody has paid. None of this may appear below. */
const ENTITLEMENT_SURFACE = [
  "checkPremiumAccess",
  "hasPremiumAccess",
  "PremiumRequired",
  "useCydAccount",
  "requirePremium",
];

/**
 * Everything between a picked archive and a browsed record.
 *
 * Directories rather than a file list, so that a new module inside one of them
 * is covered the day it is written rather than the day somebody remembers.
 */
const FREE_DIRECTORIES = [
  "services/archive-export",
  "services/archive-import",
  "services/archive-merge",
  "services/archive-restore",
  "app/account/tabs/browse",
];

const FREE_FILES = [
  "hooks/use-bluesky-archive-export.ts",
  "hooks/use-bluesky-archive-import.ts",
  "components/BlueskyArchiveExportModal.tsx",
  "components/BlueskyArchiveImportModal.tsx",
  "components/account/browse-shared.tsx",
  "app/account/tabs/browse-tab.tsx",
  "services/archive-metadata.ts",
  "services/archive-semantics.ts",
];

function sourceFiles(): string[] {
  const files = FREE_FILES.map((file) => path.join(REPOSITORY_ROOT, file));
  for (const directory of FREE_DIRECTORIES) {
    const absolute = path.join(REPOSITORY_ROOT, directory);
    for (const entry of fs.readdirSync(absolute, {
      withFileTypes: true,
      recursive: true,
    })) {
      const location = path.join(entry.parentPath, entry.name);
      if (
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !location.includes("__tests__")
      ) {
        files.push(location);
      }
    }
  }
  return files;
}

describe("archive recovery and browsing are not paywalled", () => {
  it("covers every file it claims to cover", () => {
    // A path that has moved would otherwise make this suite pass by checking
    // nothing, which is the one way an absence test can lie.
    for (const file of [...FREE_FILES, ...FREE_DIRECTORIES]) {
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, file))).toBe(true);
    }
    expect(sourceFiles().length).toBeGreaterThan(30);
  });

  it.each(ENTITLEMENT_SURFACE)(
    "never asks %s between a picked archive and a browsed record",
    (symbol) => {
      const offenders = sourceFiles().filter((file) =>
        fs.readFileSync(file, "utf8").includes(symbol),
      );
      expect(
        offenders.map((file) => path.relative(REPOSITORY_ROOT, file)),
      ).toEqual([]);
    },
  );
});
