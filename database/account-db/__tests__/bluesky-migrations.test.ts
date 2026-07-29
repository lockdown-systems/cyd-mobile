import { blueskyAccountMigrations } from "../bluesky-migrations";

describe("Bluesky account migrations", () => {
  it("adds account-local content-addressed media assets", () => {
    const migration = blueskyAccountMigrations.find(
      ({ name }) => name === "preserve media assets",
    );

    expect(migration).toBeDefined();
    expect(migration?.statements.join("\n")).toContain(
      "CREATE TABLE IF NOT EXISTS media_asset",
    );
    expect(migration?.statements.join("\n")).toContain("contentCid TEXT");
    expect(migration?.statements.join("\n")).toContain("localPath TEXT");
    expect(migration?.statements.join("\n")).toContain("downloadState TEXT");
    expect(migration?.statements.join("\n")).toContain("assetCid TEXT");
  });
});
