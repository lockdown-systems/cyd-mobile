import { givesWayToTheScreen } from "../scheduling";

/**
 * An export shares a thread with the screen that is watching it.
 *
 * Its long passes await, but they await work that has already finished, and a
 * resolved promise is drained inside the same tick — so React was told about
 * progress it never got to commit, and a tap on Cancel sat unread until the
 * export was over. On a real account that was a card frozen on its first
 * message for most of a minute, and a Cancel button that did nothing however
 * hard somebody pressed it.
 *
 * So what is held down here is both halves: that giving way actually lets a
 * timer run, and that it is not paid for on every item of every pass.
 */

/** Something only a fresh task can do, unlike an already-resolved promise. */
function waitingInTheQueue(): { ran: () => boolean; cancel: () => void } {
  let ran = false;
  const timer = setTimeout(() => {
    ran = true;
  }, 0);
  return { ran: () => ran, cancel: () => clearTimeout(timer) };
}

function busy(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* hold the thread the way a pass of an export does */
  }
}

describe("giving way to the screen", () => {
  it("lets work that is waiting run", async () => {
    const giveWay = givesWayToTheScreen();
    const queued = waitingInTheQueue();

    busy(60);
    await giveWay();

    expect(queued.ran()).toBe(true);
    queued.cancel();
  });

  /**
   * A pass that gave way on every item would pay a task's overhead per
   * thumbnail. The point is to be interruptible, not to be slow about it.
   */
  it("does not give way again until it has held the thread a while", async () => {
    const giveWay = givesWayToTheScreen();
    busy(60);
    await giveWay();

    const queued = waitingInTheQueue();
    await giveWay();
    await giveWay();

    expect(queued.ran()).toBe(false);
    queued.cancel();
  });
});
