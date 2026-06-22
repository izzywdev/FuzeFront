import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView; the message list calls it on stream.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
