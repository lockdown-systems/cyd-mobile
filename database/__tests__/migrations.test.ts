import { migrations } from "../migrations";

describe("Database Migrations", () => {
  describe("migration structure", () => {
    it("should have at least one migration", () => {
      expect(migrations.length).toBeGreaterThan(0);
    });

    it("should have sequential version numbers starting from 1", () => {
      migrations.forEach((migration, index) => {
        expect(migration.version).toBe(index + 1);
      });
    });

    it("should have unique version numbers", () => {
      const versions = migrations.map((m) => m.version);
      const uniqueVersions = new Set(versions);
      expect(uniqueVersions.size).toBe(versions.length);
    });

    it("should have non-empty names", () => {
      migrations.forEach((migration) => {
        expect(migration.name).toBeTruthy();
        expect(typeof migration.name).toBe("string");
        expect(migration.name.length).toBeGreaterThan(0);
      });
    });

    it("should have at least one statement per migration", () => {
      migrations.forEach((migration) => {
        expect(migration.statements.length).toBeGreaterThan(0);
      });
    });
  });

  describe("migration 1: initial schema", () => {
    const migration = migrations[0];

    it("should have correct version and name", () => {
      expect(migration.version).toBe(1);
      expect(migration.name).toBe("initial schema");
    });

    it("should create bsky_account table", () => {
      const createTableStatement = migration.statements.find((s) =>
        s.includes("CREATE TABLE IF NOT EXISTS bsky_account")
      );
      expect(createTableStatement).toBeTruthy();
    });

    it("should include session columns in bsky_account table", () => {
      const createTableStatement = migration.statements.find((s) =>
        s.includes("CREATE TABLE IF NOT EXISTS bsky_account")
      );
      expect(createTableStatement).toContain("did TEXT");
      expect(createTableStatement).toContain("accessJwt TEXT");
      expect(createTableStatement).toContain("refreshJwt TEXT");
      expect(createTableStatement).toContain("sessionJson TEXT");
      expect(createTableStatement).toContain("lastSavedAt INTEGER");
    });

    it("should create unique index on did", () => {
      const createIndexStatement = migration.statements.find((s) =>
        s.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_bsky_account_did")
      );
      expect(createIndexStatement).toBeTruthy();
      expect(createIndexStatement).toContain("bsky_account(did)");
    });

    it("should create account table with foreign key to bsky_account", () => {
      const createTableStatement = migration.statements.find((s) =>
        s.includes("CREATE TABLE IF NOT EXISTS account")
      );
      expect(createTableStatement).toBeTruthy();
      expect(createTableStatement).toContain("FOREIGN KEY (bskyAccountID)");
      expect(createTableStatement).toContain("REFERENCES bsky_account(id)");
    });

    it("should create index on account sortOrder", () => {
      const createIndexStatement = migration.statements.find((s) =>
        s.includes("CREATE INDEX IF NOT EXISTS idx_account_sort_order")
      );
      expect(createIndexStatement).toBeTruthy();
      expect(createIndexStatement).toContain("account(sortOrder ASC, id ASC)");
    });

    it("should enforce type constraint on account table", () => {
      const createTableStatement = migration.statements.find((s) =>
        s.includes("CREATE TABLE IF NOT EXISTS account")
      );
      expect(createTableStatement).toContain("CHECK (type IN ('bluesky'))");
    });

    it("should create cyd_account table", () => {
      const createTableStatement = migration.statements.find((s) =>
        s.includes("CREATE TABLE IF NOT EXISTS cyd_account")
      );
      expect(createTableStatement).toBeTruthy();
      expect(createTableStatement).toContain("userEmail TEXT");
      expect(createTableStatement).toContain("deviceToken TEXT");
      expect(createTableStatement).toContain("deviceUUID TEXT");
    });

    it("should insert default cyd_account row", () => {
      const insertStatement = migration.statements.find((s) =>
        s.includes("INSERT OR IGNORE INTO cyd_account")
      );
      expect(insertStatement).toBeTruthy();
    });
  });
});
