import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit tests for the DS primitives themselves (RTL + a11y/fail-closed cases).
// Component tests live beside their .jsx (components/**/*.test.jsx).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.js"],
    include: ["components/**/*.test.{jsx,js}"],
    css: false,
  },
});
