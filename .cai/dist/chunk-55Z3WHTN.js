#!/usr/bin/env node

// src/codex/regex.ts
function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}
function extractExports(content) {
  const exports = [];
  const lines = content.split("\n");
  let currentClass = null;
  let currentInterface = null;
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (currentClass || currentInterface) {
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;
      if (braceDepth <= 0) {
        currentClass = null;
        currentInterface = null;
        braceDepth = 0;
        continue;
      }
    }
    if (currentClass) {
      const methodMatch = line.match(/^\s+(?:async\s+)?(\w+)\s*(\([^)]*\))\s*(?::\s*([\w<>[\]|& ]+))?/);
      if (methodMatch && !line.includes("private") && !line.includes("#") && methodMatch[1] !== "constructor") {
        let params = methodMatch[2];
        if (params.length > 50) params = params.slice(0, 47) + "...";
        const returns = methodMatch[3] ? truncate(methodMatch[3], 30) : void 0;
        exports.push({ kind: "method", name: methodMatch[1], detail: params, returns, parent: currentClass });
      }
      continue;
    }
    if (currentInterface) {
      const fieldMatch = line.match(/^\s+(?:readonly\s+)?(\w+)\??\s*:\s*(.+?)(?:;|\s*$)/);
      if (fieldMatch && currentInterface.fields.length < 8) {
        const fieldType = truncate(fieldMatch[2].replace(/;$/, "").trim(), 40);
        currentInterface.fields.push(`${fieldMatch[1]}: ${fieldType}`);
      }
      continue;
    }
    const fnMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))\s*(?::\s*([\w<>[\]|& ]+))?/);
    if (fnMatch) {
      let params = fnMatch[2];
      if (params.length > 60) params = params.slice(0, 57) + "...";
      const returns = fnMatch[3] ? truncate(fnMatch[3], 30) : void 0;
      exports.push({ kind: "fn", name: fnMatch[1], detail: params, returns });
      continue;
    }
    const arrowMatch = line.match(
      /^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([\w<>[\]|& ]+))?\s*=>/
    );
    if (arrowMatch) {
      let params = `(${arrowMatch[2]})`;
      if (params.length > 60) params = params.slice(0, 57) + "...";
      const returns = arrowMatch[3] ? truncate(arrowMatch[3], 30) : void 0;
      exports.push({ kind: "fn", name: arrowMatch[1], detail: params, returns });
      continue;
    }
    const classMatch = line.match(/^export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      currentClass = classMatch[1];
      braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      exports.push({ kind: "class", name: classMatch[1], detail: "" });
      continue;
    }
    const typeMatch = line.match(/^export\s+(?:interface|type)\s+(\w+)/);
    if (typeMatch) {
      const fields = [];
      exports.push({ kind: "type", name: typeMatch[1], detail: "", fields });
      if (line.includes("{")) {
        currentInterface = { name: typeMatch[1], fields };
        braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (braceDepth <= 0) currentInterface = null;
      }
      continue;
    }
    const constMatch = line.match(/^export\s+const\s+(\w+)\s*(?::\s*([\w<>[\]|& ,]+?))?\s*=/);
    if (constMatch) {
      const typePart = constMatch[2] ? `: ${constMatch[2].trim()}` : "";
      exports.push({ kind: "const", name: constMatch[1], detail: typePart });
      continue;
    }
    const reExportMatch = line.match(/^export\s+\{([^}]+)\}/);
    if (reExportMatch) {
      for (const part of reExportMatch[1].split(",")) {
        const segments = part.trim().split(/\s+as\s+/);
        const name = (segments.length > 1 ? segments[1] : segments[0])?.trim();
        if (name && name !== "default") {
          exports.push({ kind: "const", name, detail: "(re-export)" });
        }
      }
    }
  }
  return exports;
}
function extractImports(content) {
  const imports = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:\{[^}]*\}|\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+["']([^"']+)["']/g,
    /require\(["']([^"']+)["']\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      imports.push(match[1]);
    }
    pattern.lastIndex = 0;
  }
  return imports;
}

export {
  truncate,
  extractExports,
  extractImports
};
//# sourceMappingURL=chunk-55Z3WHTN.js.map