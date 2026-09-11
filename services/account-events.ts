type LocalAccountsListener = () => void;

const listeners = new Set<LocalAccountsListener>();

/**
 * Notice when the set of Bluesky local accounts changes.
 *
 * A Bluesky archive import can create an account, or fold two of them into
 * one, from a menu that lives outside the accounts list (#97). The list
 * refreshes when it regains focus, which never happens for a modal opened over
 * it, so it listens here instead. Modelled on `services/auth-events.ts`.
 */
export function onLocalAccountsChanged(
  listener: LocalAccountsListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitLocalAccountsChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[account-events] listener error", err);
    }
  }
}
