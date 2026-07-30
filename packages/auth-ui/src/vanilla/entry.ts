// IIFE entry point for the vanilla build. esbuild bundles this with
// `format: 'iife', globalName: 'FuzeFrontAuthUI'`, so this module's exports
// become `window.FuzeFrontAuthUI`.
export { mount } from './mount'
export type { VanillaMountOptions, VanillaMountHandle } from './mount'
