// Vitest global setup — polyfill the browser APIs the marketing shell relies
// on that jsdom does not implement.
import { vi } from "vitest";

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom's scrollTo / scrollIntoView throw "Not implemented"; make them no-ops.
window.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();
