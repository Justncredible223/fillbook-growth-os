import { defineConfig } from "vitest/config";

// This worktree happens to live under the OS temp directory in this sandboxed
// session, and Vite's CSS plugin walks up the directory tree looking for a
// postcss config, which can hit an unrelated file there and crash before any
// test runs. These are plain Node/TS unit tests with no CSS involved, so we
// pin the project root and turn CSS handling off entirely.
export default defineConfig({
  root: __dirname,
  css: false,
});
