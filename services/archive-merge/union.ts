/**
 * The four rules a recovery union comes down to.
 *
 * They are small on purpose: every column of every table in `merge-plan.ts` is
 * settled by one of them, so "what does importing an old archive do to my
 * account?" has one answer to read rather than one per table.
 */

function populated(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Keep whichever side actually says something.
 *
 * Absence is never an observation: an archive exported before Cyd captured a
 * post's alt text, or one written by a client that has no column for it, says
 * nothing about that field rather than saying it is empty. Only when both
 * sides hold a value does the newer observation win.
 */
export function preferPopulated<T>(
  local: T,
  incoming: T,
  incomingIsNewer: boolean,
): T {
  if (!populated(incoming)) {
    return local;
  }
  if (!populated(local)) {
    return incoming;
  }
  return incomingIsNewer ? incoming : local;
}

/** A flag either side set stays set: a union never takes a like back. */
export function unionFlag(
  local: number | null,
  incoming: number | null,
): number {
  return local === 1 || incoming === 1 ? 1 : 0;
}

/** The first time either side saw something happen, such as a deletion. */
export function earliest(
  local: number | null,
  incoming: number | null,
): number | null {
  if (local === null) {
    return incoming;
  }
  if (incoming === null) {
    return local;
  }
  return Math.min(local, incoming);
}

/** The most recent of two timestamps, when later means better informed. */
export function latest(
  local: number | null,
  incoming: number | null,
): number | null {
  if (local === null) {
    return incoming;
  }
  if (incoming === null) {
    return local;
  }
  return Math.max(local, incoming);
}
