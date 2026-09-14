/**
 * Handing the thread back, so the screen can catch up with the export.
 *
 * An export runs on the same thread that draws the screen and delivers
 * touches. Its long passes await, but they await work that is already
 * finished, and a promise that is already resolved is drained inside the same
 * tick — so React is told about progress it never gets to commit, and a tap on
 * Cancel sits in the queue unread. The symptom is an export that appears to
 * freeze on its first message for a minute and ignore the one button it
 * offers, which is not slowness: nothing ever asked.
 *
 * A timer is what actually hands the thread back, because it schedules a new
 * task rather than joining this one.
 */

/** How long a pass may hold the thread before letting the screen in. */
const HOLD_THREAD_MS = 50;

/**
 * A `yield` for one pass of an export, which gives way on a timer.
 *
 * Time rather than a count of items: an account of thumbnails and an account
 * of video would otherwise need different numbers to stay equally responsive,
 * and the cost of giving way is only ever paid once per `HOLD_THREAD_MS` of
 * real work.
 */
export function givesWayToTheScreen(): () => Promise<void> {
  let heldSince = Date.now();
  return async () => {
    if (Date.now() - heldSince < HOLD_THREAD_MS) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    heldSince = Date.now();
  };
}
