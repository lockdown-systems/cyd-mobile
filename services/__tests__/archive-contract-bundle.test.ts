import fs from "fs";
import path from "path";

import { classifyBlueskyArchiveMetadata } from "../archive-metadata";
import {
  type BlueskyArchiveTables,
  normalizeBlueskyArchiveSemantics,
} from "../archive-semantics";

const contractRoot = process.env.CYD_BLUESKY_CONTRACT_ROOT;
const contractDescribe = contractRoot ? describe : describe.skip;

type ContractInput = {
  metadata: Record<string, unknown>;
  tables: BlueskyArchiveTables;
};

function readExpectations(root: string) {
  return JSON.parse(
    fs.readFileSync(
      path.join(root, "fixtures/semantic-expectations.json"),
      "utf8",
    ),
  ) as {
    commonSemantics: Record<string, unknown>;
    fixtures: Record<
      string,
      { assets: Record<string, unknown>[]; completeness: string }
    >;
    desktopBlueskyVersionBehavior: Record<string, string>;
  };
}

contractDescribe("pinned canonical Cyd Bluesky archive bundle", () => {
  const root = contractRoot!;

  it.each(["complete.cyd", "incomplete.cyd"])(
    "normalizes %s through Mobile semantics",
    (fixtureName) => {
      const expectations = readExpectations(root);
      const input = JSON.parse(
        fs.readFileSync(
          path.join(root, "mobile-input", `${fixtureName}.json`),
          "utf8",
        ),
      ) as ContractInput;

      expect(classifyBlueskyArchiveMetadata(input.metadata)).toEqual({
        supported: true,
        metadata: input.metadata,
      });

      const normalized = normalizeBlueskyArchiveSemantics(input.tables);
      expect(normalized.commonSemantics).toEqual(expectations.commonSemantics);
      expect(normalized.assets).toEqual(expectations.fixtures[fixtureName].assets);
      expect(normalized.completeness).toBe(
        expectations.fixtures[fixtureName].completeness,
      );
    },
  );

  it("matches the canonical version rejection outcomes", () => {
    const expectations = readExpectations(root);
    const input = JSON.parse(
      fs.readFileSync(
        path.join(root, "mobile-input", "complete.cyd.json"),
        "utf8",
      ),
    ) as ContractInput;

    expect(expectations.desktopBlueskyVersionBehavior).toMatchObject({
      unversionedV1: "reject_unsupported_legacy_format",
      blueskyV2Import: "accept",
      otherPlatform: "reject_unsupported_archive_platform",
      newerVersion: "reject_unsupported_newer_version",
    });

    expect(
      classifyBlueskyArchiveMetadata({ ...input.metadata, version: 3 }),
    ).toMatchObject({ supported: false, reason: "newer-version" });
    expect(
      classifyBlueskyArchiveMetadata({ ...input.metadata, platform: "x" }),
    ).toMatchObject({ supported: false, reason: "platform" });
    expect(
      classifyBlueskyArchiveMetadata({
        type: "bluesky",
        uuid: input.metadata.accountUuid,
        exportTimestamp: input.metadata.createdAt,
        account: {},
      }),
    ).toMatchObject({ supported: false, reason: "legacy" });
  });
});
