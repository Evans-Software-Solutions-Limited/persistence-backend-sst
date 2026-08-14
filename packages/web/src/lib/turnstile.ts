/**
 * Cloudflare Turnstile loader (spec-30 WS3). Lazily injects the Turnstile
 * script — never eagerly at startup — and caches the load so multiple forms
 * on one page share a single script tag.
 *
 * The corresponding backend check (`TURNSTILE_SECRET` unset → verification
 * skipped, see `microservices/core/src/application/leads/turnstile.ts`) is
 * unconfigured by default, so a stage without `VITE_TURNSTILE_SITE_KEY` set
 * never renders the widget and submission behaves exactly as it does today.
 */

export interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

// Marks a script tag whose `load` event has already fired, so a later
// caller that finds the tag already in the DOM (e.g. a second component, or
// a fresh module instance) can resolve immediately instead of attaching a
// listener for an event that already happened and will never fire again.
const LOADED_ATTR = "data-turnstile-loaded";

let scriptPromise: Promise<void> | null = null;

/**
 * Inject the Turnstile script once and resolve when `window.turnstile` is
 * ready. Safe to call from multiple components; the underlying script tag
 * is only ever added once per page load.
 *
 * On a load error, the cached promise is cleared so a later call attempts
 * a fresh load rather than replaying the same rejection forever.
 */
export function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve();
  }
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const onError = () => {
      // Don't leave a rejected promise cached — a later call should get a
      // real second attempt, not the same failure forever.
      scriptPromise = null;
      reject(new Error("Failed to load Turnstile script"));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      if (existing.hasAttribute(LOADED_ATTR) || window.turnstile) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        existing.setAttribute(LOADED_ATTR, "true");
        resolve();
      });
      existing.addEventListener("error", onError);
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      script.setAttribute(LOADED_ATTR, "true");
      resolve();
    });
    script.addEventListener("error", onError);
    document.head.appendChild(script);
  });

  return scriptPromise;
}
