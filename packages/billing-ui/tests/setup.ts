import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView; some panels call it on mount.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom lacks matchMedia, which some layout-aware components probe.
if (!window.matchMedia) {
  // @ts-expect-error – minimal stub for tests
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
