/**
 * CRC-32 (IEEE 802.3), the checksum every ZIP entry carries in its headers.
 *
 * The manifest's SHA-256 digests are the real integrity check for archive
 * payloads, but `manifest.json` itself is not one of those payloads, so its
 * CRC is the only corruption check available for it.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** Incremental CRC-32, so entries can be checked while they stream. */
export class Crc32 {
  private state = 0xffffffff;

  update(chunk: Uint8Array): void {
    let state = this.state;
    for (let index = 0; index < chunk.length; index += 1) {
      state = TABLE[(state ^ chunk[index]) & 0xff] ^ (state >>> 8);
    }
    this.state = state >>> 0;
  }

  value(): number {
    return (this.state ^ 0xffffffff) >>> 0;
  }
}

export function crc32(data: Uint8Array): number {
  const checksum = new Crc32();
  checksum.update(data);
  return checksum.value();
}
