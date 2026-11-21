import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom lacks these browser APIs used by Recharts / Radix / the chat view.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = RO;
Element.prototype.scrollTo = vi.fn() as any;
Element.prototype.scrollIntoView = vi.fn() as any;
Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
window.matchMedia =
  window.matchMedia ||
  ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as any;
