import { Inflate } from "fflate";

import { ArchiveIntakeError } from "./errors";
import type { CreateDecompressor, Decompressor } from "./ports";

/**
 * Streaming raw-DEFLATE decompression, the only compression method a Cyd
 * Bluesky archive uses besides stored entries.
 *
 * This exists because the importer must see entry bytes as they arrive: an
 * extract-all API would write a zip bomb to disk before anyone could measure
 * it. See ADR 0009.
 */
function isFlateError(error: unknown): error is Error & { code: number } {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "number"
  );
}

export const createInflateDecompressor: CreateDecompressor = (
  onBytes,
): Decompressor => {
  const inflate = new Inflate((chunk) => {
    if (chunk.length > 0) {
      onBytes(chunk);
    }
  });

  return {
    push(chunk: Uint8Array, final: boolean): void {
      try {
        inflate.push(chunk, final);
      } catch (error) {
        // fflate raises numbered FlateErrors. Anything else came back up from
        // the sink -- a limit we tripped, or storage failing -- and must not be
        // reported as a corrupt archive: blaming the file would throw away a
        // staging area that a later launch could have resumed.
        if (!isFlateError(error)) {
          throw error;
        }
        throw new ArchiveIntakeError(
          "corrupt-archive",
          `The archive contains compressed data that could not be read: ${error.message}`,
        );
      }
    },
  };
};
