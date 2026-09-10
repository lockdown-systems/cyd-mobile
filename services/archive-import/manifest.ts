import { requireStagedFilePath } from "./entry-paths";
import { BlueskyArchiveIntakeError } from "./errors";
import type { ZipEntry } from "./zip-reader";

/**
 * The `manifest.json` of a Cyd Bluesky archive: the archive's own account of
 * what it contains.
 *
 * It is checked against the ZIP's directory in both directions. An entry the
 * manifest does not list is an entry nobody promised to be safe, and a payload
 * the ZIP does not carry means the package is incomplete — either way the
 * archive is rejected before anything is written.
 */

export const METADATA_ENTRY_PATH = "metadata.json";
export const MANIFEST_ENTRY_PATH = "manifest.json";
export const DATABASE_ENTRY_PATH = "data.db";

export type BlueskyArchiveManifestPayload = {
  path: string;
  bytes: number;
  sha256: string;
};

export type BlueskyArchiveManifest = {
  algorithm: "sha256";
  payloads: BlueskyArchiveManifestPayload[];
};

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function invalid(detail: string): never {
  throw new BlueskyArchiveIntakeError(
    "manifest-invalid",
    `The archive's manifest is invalid: ${detail}`,
  );
}

export function parseBlueskyArchiveManifest(text: string): BlueskyArchiveManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid("it is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    invalid("it does not contain an object.");
  }

  const manifest = parsed as Record<string, unknown>;
  if (manifest.algorithm !== "sha256") {
    invalid("it does not use SHA-256 digests.");
  }
  if (!Array.isArray(manifest.payloads)) {
    invalid("it does not list any payloads.");
  }

  const payloads: BlueskyArchiveManifestPayload[] = [];
  const seen = new Set<string>();
  for (const entry of manifest.payloads) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      invalid("one of its payloads is not an object.");
    }
    const payload = entry as Record<string, unknown>;
    if (typeof payload.path !== "string") {
      invalid("one of its payloads has no path.");
    }
    const path = requireStagedFilePath(payload.path);
    if (path === MANIFEST_ENTRY_PATH) {
      invalid("it lists itself as a payload.");
    }
    if (seen.has(path.toLowerCase())) {
      invalid(`it lists ${path} more than once.`);
    }
    seen.add(path.toLowerCase());

    if (
      typeof payload.bytes !== "number" ||
      !Number.isInteger(payload.bytes) ||
      payload.bytes < 0
    ) {
      invalid(`it declares an invalid size for ${path}.`);
    }
    if (typeof payload.sha256 !== "string" || !SHA256_PATTERN.test(payload.sha256)) {
      invalid(`it declares an invalid digest for ${path}.`);
    }

    payloads.push({
      path,
      bytes: payload.bytes,
      sha256: payload.sha256,
    });
  }

  return { algorithm: "sha256", payloads };
}

export type BlueskyArchivePayloadPlan = {
  entry: ZipEntry;
  payload: BlueskyArchiveManifestPayload;
};

/**
 * Match the manifest against the ZIP directory, in ZIP order so that reads
 * stay sequential.
 */
export function planBlueskyArchivePayloads(
  manifest: BlueskyArchiveManifest,
  entries: ZipEntry[],
): BlueskyArchivePayloadPlan[] {
  const byPath = new Map(manifest.payloads.map((payload) => [payload.path, payload]));
  const plan: BlueskyArchivePayloadPlan[] = [];

  for (const entry of entries) {
    if (entry.path === MANIFEST_ENTRY_PATH) {
      continue;
    }
    const payload = byPath.get(entry.path);
    if (!payload) {
      throw new BlueskyArchiveIntakeError(
        "manifest-mismatch",
        `The archive contains ${entry.path}, which its manifest does not list.`,
      );
    }
    if (payload.bytes !== entry.uncompressedBytes) {
      throw new BlueskyArchiveIntakeError(
        "manifest-mismatch",
        `The archive's manifest declares a different size for ${entry.path} than the archive does.`,
      );
    }
    byPath.delete(entry.path);
    plan.push({ entry, payload });
  }

  const missing = [...byPath.keys()];
  if (missing.length > 0) {
    throw new BlueskyArchiveIntakeError(
      "manifest-mismatch",
      `The archive is missing ${missing[0]}, which its manifest lists.`,
    );
  }

  for (const required of [METADATA_ENTRY_PATH, DATABASE_ENTRY_PATH]) {
    if (!plan.some((planned) => planned.payload.path === required)) {
      throw new BlueskyArchiveIntakeError(
        required === METADATA_ENTRY_PATH ? "metadata-missing" : "manifest-mismatch",
        `The archive is missing ${required}.`,
      );
    }
  }

  return plan;
}
