import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only server for the primitives harness (design-system/harness/index.html).
// Not part of the published package. Run: npx vite --config design-system/harness/vite.config.mjs
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  plugins: [react()],
  server: { port: 4417, strictPort: true },
});
