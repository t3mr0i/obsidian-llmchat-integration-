import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: true,
  sourcemap: true,
  dts: false,
  external: ["web-tree-sitter"],
  banner: {
    js: "#!/usr/bin/env node",
  },
  async onSuccess() {
    const { cpSync, mkdirSync, existsSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);

    const wasmDir = join("dist", "wasm");
    mkdirSync(wasmDir, { recursive: true });

    // Copy tree-sitter runtime WASM
    try {
      const treeSitterWasm = require.resolve("web-tree-sitter/tree-sitter.wasm");
      cpSync(treeSitterWasm, join(wasmDir, "tree-sitter.wasm"));
    } catch {
      // web-tree-sitter not installed — skip
    }

    // Copy language grammar WASMs
    const grammars = ["javascript", "typescript", "python", "go", "rust"];
    for (const lang of grammars) {
      try {
        const src = require.resolve(`tree-sitter-wasms/out/tree-sitter-${lang}.wasm`);
        cpSync(src, join(wasmDir, `tree-sitter-${lang}.wasm`));
      } catch {
        // grammar not installed — skip
      }
    }
  },
});
