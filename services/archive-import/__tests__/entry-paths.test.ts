import {
  MAX_ENTRY_PATH_LENGTH,
  checkZipEntryPath,
  decodeZipEntryName,
} from "../entry-paths";

function reasonFor(name: string): string {
  const check = checkZipEntryPath(name);
  if (check.ok) {
    throw new Error(`Expected ${JSON.stringify(name)} to be rejected`);
  }
  return check.reason;
}

describe("archive entry paths", () => {
  it("accepts the paths a canonical Bluesky archive contains", () => {
    for (const name of [
      "metadata.json",
      "manifest.json",
      "data.db",
      "media/sha256/6c/6c55d7bbccd73bb135e8e7c7161b4be3cef97142313f2fba304e73b3329ecc3d",
    ]) {
      expect(checkZipEntryPath(name)).toEqual({
        ok: true,
        path: name,
        isDirectory: false,
      });
    }
  });

  it("reports directory entries separately from the files they contain", () => {
    expect(checkZipEntryPath("media/sha256/")).toEqual({
      ok: true,
      path: "media/sha256",
      isDirectory: true,
    });
  });

  it("rejects paths that escape the staging root", () => {
    expect(reasonFor("../evil")).toMatch(/traverses outside/i);
    expect(reasonFor("media/../../evil")).toMatch(/traverses outside/i);
    expect(reasonFor("..")).toMatch(/traverses outside/i);
    expect(reasonFor("media/..")).toMatch(/traverses outside/i);
  });

  it("rejects absolute paths", () => {
    expect(reasonFor("/etc/passwd")).toMatch(/absolute/i);
    expect(reasonFor("//server/share/file")).toMatch(/absolute/i);
    expect(reasonFor("C:/Windows/system.ini")).toMatch(/absolute/i);
    expect(reasonFor("c:file")).toMatch(/absolute/i);
  });

  it("rejects paths that are not already normalized", () => {
    expect(reasonFor("./data.db")).toMatch(/normalized/i);
    expect(reasonFor("media//data.db")).toMatch(/normalized/i);
    expect(reasonFor("media/./data.db")).toMatch(/normalized/i);
    expect(reasonFor(".")).toMatch(/normalized/i);
  });

  it("rejects backslashes, so Windows separators cannot smuggle a segment", () => {
    expect(reasonFor("media\\..\\evil")).toMatch(/backslash/i);
    expect(reasonFor("media\\data.db")).toMatch(/backslash/i);
  });

  it("rejects empty and control-character paths", () => {
    expect(reasonFor("")).toMatch(/empty/i);
    expect(reasonFor("data\u0000.db")).toMatch(/control character/i);
    expect(reasonFor("data\n.db")).toMatch(/control character/i);
    expect(reasonFor("data\u007f.db")).toMatch(/control character/i);
  });

  it("rejects paths longer than the supported limit", () => {
    expect(reasonFor(`${"a".repeat(MAX_ENTRY_PATH_LENGTH)}.db`)).toMatch(
      /too long/i,
    );
  });

  it("decodes entry names as strict UTF-8", () => {
    expect(decodeZipEntryName(new TextEncoder().encode("média.json"))).toBe(
      "média.json",
    );
    expect(decodeZipEntryName(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
  });
});
