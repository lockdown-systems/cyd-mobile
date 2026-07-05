/* eslint-disable @typescript-eslint/no-require-imports */
import { install } from "react-native-quick-crypto";

install();

if (typeof global.TextEncoder === "undefined") {
  const TextEncoding = require("text-encoding");
  global.TextEncoder = TextEncoding.TextEncoder;
  global.TextDecoder = TextEncoding.TextDecoder;
}

if (typeof Intl.Segmenter === "undefined") {
  require("@formatjs/intl-segmenter/polyfill.js");
}

if (
  typeof globalThis.AbortController === "undefined" ||
  typeof globalThis.AbortSignal === "undefined"
) {
  class PolyfillAbortSignal extends EventTarget implements AbortSignal {
    aborted = false;
    onabort: ((this: AbortSignal, ev: Event) => any) | null = null;
    reason: any;
    throwIfAborted(): void {
      if (this.aborted) {
        throw this.reason ?? new Error("AbortError");
      }
    }
  }

  class PolyfillAbortController implements AbortController {
    signal: PolyfillAbortSignal;
    constructor() {
      this.signal = new PolyfillAbortSignal();
    }
    abort(reason?: any): void {
      if (this.signal.aborted) {
        return;
      }
      this.signal.aborted = true;
      this.signal.reason = reason ?? new Error("AbortError");
      const event = new Event("abort");
      this.signal.dispatchEvent(event);
      this.signal.onabort?.(event);
    }
  }

  (globalThis as any).AbortController = PolyfillAbortController;
  (globalThis as any).AbortSignal = PolyfillAbortSignal;
}

if (
  typeof globalThis.AbortSignal !== "undefined" &&
  typeof (globalThis.AbortSignal as any).prototype?.throwIfAborted !==
    "function"
) {
  (globalThis.AbortSignal as any).prototype.throwIfAborted = function () {
    if (this.aborted) {
      throw this.reason ?? new Error("AbortError");
    }
  };
}

if (typeof (globalThis.AbortSignal as any).timeout !== "function") {
  (globalThis.AbortSignal as any).timeout = function timeout(ms: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const reason =
        typeof DOMException === "function"
          ? new DOMException("Timeout", "TimeoutError")
          : new Error("TimeoutError");
      // Passing reason only if supported by the current environment
      try {
        controller.abort(reason);
      } catch {
        controller.abort();
      }
    }, ms);
    controller.signal.addEventListener("abort", () => clearTimeout(timer));
    return controller.signal;
  };
}

if (typeof globalThis.CryptoKey === "undefined") {
  const cryptoInstance = globalThis.crypto as any;
  if (cryptoInstance?.CryptoKey) {
    (globalThis as any).CryptoKey = cryptoInstance.CryptoKey;
  } else {
    const {
      CryptoKey,
    } = require("react-native-quick-crypto/lib/commonjs/keys/classes");
    (globalThis as any).CryptoKey = CryptoKey;
  }
}

// Polyfill Event for @atproto/oauth-client
if (typeof globalThis.Event === "undefined") {
  (globalThis as any).Event = class Event {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    constructor(type: string, eventInitDict?: EventInit) {
      this.type = type;
      this.bubbles = eventInitDict?.bubbles ?? false;
      this.cancelable = eventInitDict?.cancelable ?? false;
    }
  };
}

// Polyfill EventTarget for @atproto/oauth-client
if (typeof globalThis.EventTarget === "undefined") {
  (globalThis as any).EventTarget = class EventTarget {
    private listeners: Record<string, EventListenerOrEventListenerObject[]> =
      {};

    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) {
      if (!listener) return;
      if (!this.listeners[type]) {
        this.listeners[type] = [];
      }
      this.listeners[type].push(listener);
    }

    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) {
      if (!listener || !this.listeners[type]) return;
      const index = this.listeners[type].indexOf(listener);
      if (index !== -1) {
        this.listeners[type].splice(index, 1);
      }
    }

    dispatchEvent(event: Event): boolean {
      if (!this.listeners[event.type]) return true;
      this.listeners[event.type].forEach((listener) => {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      });
      return true;
    }
  };
}

// Polyfill CustomEvent for @atproto/oauth-client
if (typeof globalThis.CustomEvent === "undefined") {
  (globalThis as any).CustomEvent = class CustomEvent extends (
    (globalThis as any).Event
  ) {
    detail: any;
    constructor(type: string, eventInitDict?: CustomEventInit) {
      super(type, eventInitDict);
      this.detail = eventInitDict?.detail;
    }
  };
}
