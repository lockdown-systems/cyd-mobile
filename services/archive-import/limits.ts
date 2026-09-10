/**
 * Resource thresholds for Bluesky archive intake.
 *
 * A Cyd Bluesky archive holds full-size images and full video, so a legitimate
 * one can be enormous. These limits are therefore shaped to catch archives
 * that are *dishonest* — bombs, absurd entry counts, packages that will not
 * fit — while a merely large archive is handled by asking the person to
 * confirm rather than by refusing it.
 */

export type ArchiveIntakeLimits = {
  /** Entry count ceiling, well above any real archive. */
  maxEntries: number;
  /** Arithmetic ceiling, not a product limit. */
  maxTotalBytes: number;
  /** Above this, intake stops and asks for explicit confirmation. */
  confirmationThresholdBytes: number;
  /** Highest tolerated ratio of unpacked bytes to packed bytes. */
  maxExpansionRatio: number;
  /** Small archives compress unevenly, so the ratio only applies above this. */
  expansionRatioFloorBytes: number;
  /** Free space to leave on the volume after staging the archive. */
  storageHeadroomBytes: number;
  /** Largest metadata.json or manifest.json we will read into memory. */
  maxDescriptorBytes: number;
};

const GIBIBYTE = 1024 * 1024 * 1024;

export const DEFAULT_ARCHIVE_INTAKE_LIMITS: ArchiveIntakeLimits = {
  maxEntries: 200_000,
  maxTotalBytes: 512 * GIBIBYTE,
  confirmationThresholdBytes: 2 * GIBIBYTE,
  maxExpansionRatio: 100,
  expansionRatioFloorBytes: 4 * 1024 * 1024,
  storageHeadroomBytes: 256 * 1024 * 1024,
  maxDescriptorBytes: 4 * 1024 * 1024,
};

export function resolveArchiveIntakeLimits(
  overrides?: Partial<ArchiveIntakeLimits>,
): ArchiveIntakeLimits {
  return { ...DEFAULT_ARCHIVE_INTAKE_LIMITS, ...overrides };
}

export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
