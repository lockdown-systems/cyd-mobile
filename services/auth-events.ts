import type { AccountAuthStatusValue } from "@/controllers/config";

export type AuthStatusChangeEvent = {
  accountId: number;
  status: AccountAuthStatusValue;
};

type AuthStatusListener = (event: AuthStatusChangeEvent) => void;

const listeners = new Set<AuthStatusListener>();

export function onAuthStatusChange(listener: AuthStatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAuthStatusChange(event: AuthStatusChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn("[auth-events] listener error", err);
    }
  }
}
