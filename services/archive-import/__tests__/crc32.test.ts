import zlib from "zlib";

import { Crc32, crc32 } from "../crc32";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("matches zlib over binary data", () => {
    const data = new Uint8Array(1024);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (index * 37) % 256;
    }
    expect(crc32(data)).toBe(zlib.crc32(data));
  });

  it("gives the same answer whether or not the data arrives in one chunk", () => {
    const data = new TextEncoder().encode("cyd bluesky archive");
    const incremental = new Crc32();
    incremental.update(data.subarray(0, 4));
    incremental.update(data.subarray(4));
    expect(incremental.value()).toBe(crc32(data));
  });
});
