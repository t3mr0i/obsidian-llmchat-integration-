#!/usr/bin/env node

// src/utils/fs.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
function estimateTokens(content) {
  if (!content) return 0;
  const lines = content.split("\n");
  let codeChars = 0;
  let markdownChars = 0;
  let proseChars = 0;
  let inCodeBlock = false;
  for (const line of lines) {
    const len = line.length + 1;
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      markdownChars += len;
    } else if (inCodeBlock) {
      codeChars += len;
    } else if (/^#{1,6}\s|^\s*[-*]\s|^\s*\d+\.\s|^\|/.test(line)) {
      markdownChars += len;
    } else if (line.trim() === "") {
      markdownChars += len;
    } else {
      proseChars += len;
    }
  }
  return Math.ceil(codeChars / 3 + proseChars / 3.5 + markdownChars / 5);
}
function estimateFileTokens(absPath) {
  try {
    return estimateTokens(readFileSync(absPath, "utf8"));
  } catch {
    return 0;
  }
}
function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n*/, "");
}
function writeIfChanged(filePath, content) {
  if (existsSync(filePath)) {
    const current = readFileSync(filePath, "utf-8");
    if (current === content) return false;
  }
  writeFileSync(filePath, content, "utf-8");
  return true;
}

export {
  estimateTokens,
  estimateFileTokens,
  stripFrontmatter,
  writeIfChanged
};
//# sourceMappingURL=chunk-TBA32Z4B.js.map