#!/usr/bin/env node
import {
  truncate
} from "./chunk-55Z3WHTN.js";

// src/codex/tree-sitter.ts
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
var __dirname = dirname(fileURLToPath(import.meta.url));
var wasmDir = join(__dirname, "wasm");
var LANG_MAP = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust"
};
var Parser = null;
var initPromise = null;
var langCache = /* @__PURE__ */ new Map();
async function ensureInit() {
  if (Parser) return true;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const mod = await import("web-tree-sitter");
        const TSParser = mod.default;
        await TSParser.init({
          locateFile: (file) => join(wasmDir, file)
        });
        Parser = TSParser;
      } catch {
        Parser = null;
      }
    })();
  }
  await initPromise;
  return Parser !== null;
}
async function getLanguage(langName) {
  if (langCache.has(langName)) return langCache.get(langName);
  const wasmPath = join(wasmDir, `tree-sitter-${langName}.wasm`);
  if (!existsSync(wasmPath)) return null;
  try {
    const lang = await Parser.Language.load(wasmPath);
    langCache.set(langName, lang);
    return lang;
  } catch {
    return null;
  }
}
function extractFromTree(tree, langName) {
  const exports = [];
  const root = tree.rootNode;
  if (langName === "typescript" || langName === "javascript") {
    extractTS(root, exports);
  } else if (langName === "python") {
    extractPython(root, exports);
  } else if (langName === "go") {
    extractGo(root, exports);
  } else if (langName === "rust") {
    extractRust(root, exports);
  }
  return exports;
}
function extractTS(root, exports) {
  for (const node of root.children) {
    if (node.type !== "export_statement") continue;
    const decl = node.namedChildren.find(
      (c) => [
        "function_declaration",
        "class_declaration",
        "interface_declaration",
        "type_alias_declaration",
        "lexical_declaration",
        "abstract_class_declaration"
      ].includes(c.type)
    );
    if (!decl) continue;
    if (decl.type === "function_declaration") {
      const name = decl.childForFieldName("name")?.text ?? "";
      const params = decl.childForFieldName("parameters")?.text ?? "()";
      const retNode = decl.childForFieldName("return_type");
      const returns = retNode ? cleanReturnType(retNode.text) : void 0;
      exports.push({ kind: "fn", name, detail: truncate(params, 60), returns });
    }
    if (decl.type === "class_declaration" || decl.type === "abstract_class_declaration") {
      const name = decl.childForFieldName("name")?.text ?? "";
      exports.push({ kind: "class", name, detail: "" });
      const body = decl.childForFieldName("body");
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === "method_definition" || member.type === "public_field_definition") {
            if (member.type === "method_definition") {
              const mName = member.childForFieldName("name")?.text ?? "";
              if (mName === "constructor" || mName.startsWith("#") || mName.startsWith("_")) continue;
              const text = member.text;
              if (text.startsWith("private") || text.startsWith("protected")) continue;
              const mParams = member.childForFieldName("parameters")?.text ?? "()";
              const mRet = member.childForFieldName("return_type");
              exports.push({
                kind: "method",
                name: mName,
                detail: truncate(mParams, 50),
                returns: mRet ? cleanReturnType(mRet.text) : void 0,
                parent: name
              });
            }
          }
        }
      }
    }
    if (decl.type === "interface_declaration") {
      const name = decl.childForFieldName("name")?.text ?? "";
      const fields = [];
      const body = decl.childForFieldName("body");
      if (body) {
        for (const prop of body.namedChildren) {
          if (fields.length >= 8) break;
          if (prop.type === "property_signature") {
            const pName = prop.childForFieldName("name")?.text ?? "";
            const pTypeRaw = prop.childForFieldName("type")?.text ?? "";
            const pType = pTypeRaw.replace(/^:\s*/, "");
            if (pName && pType) fields.push(`${pName}: ${truncate(pType, 40)}`);
          }
        }
      }
      exports.push({ kind: "type", name, detail: "", fields });
    }
    if (decl.type === "type_alias_declaration") {
      const name = decl.childForFieldName("name")?.text ?? "";
      exports.push({ kind: "type", name, detail: "" });
    }
    if (decl.type === "lexical_declaration") {
      for (const declarator of decl.namedChildren) {
        if (declarator.type !== "variable_declarator") continue;
        const name = declarator.childForFieldName("name")?.text ?? "";
        const value = declarator.childForFieldName("value");
        if (value && (value.type === "arrow_function" || value.type === "function")) {
          const params = value.childForFieldName("parameters")?.text ?? "()";
          const retNode = value.childForFieldName("return_type");
          exports.push({
            kind: "fn",
            name,
            detail: truncate(params, 60),
            returns: retNode ? cleanReturnType(retNode.text) : void 0
          });
        } else {
          const typeNode = declarator.childForFieldName("type");
          const typePart = typeNode ? `: ${truncate(typeNode.text, 30)}` : "";
          exports.push({ kind: "const", name, detail: typePart });
        }
      }
    }
  }
}
function extractPython(root, exports) {
  for (const node of root.children) {
    if (node.type === "function_definition") {
      const name = node.childForFieldName("name")?.text ?? "";
      if (name.startsWith("_")) continue;
      const params = node.childForFieldName("parameters")?.text ?? "()";
      const retNode = node.childForFieldName("return_type");
      exports.push({
        kind: "fn",
        name,
        detail: truncate(params, 60),
        returns: retNode ? truncate(retNode.text, 30) : void 0
      });
    }
    if (node.type === "decorated_definition") {
      const inner = node.namedChildren.find(
        (c) => c.type === "function_definition" || c.type === "class_definition"
      );
      if (inner?.type === "function_definition") {
        const name = inner.childForFieldName("name")?.text ?? "";
        if (!name.startsWith("_")) {
          const params = inner.childForFieldName("parameters")?.text ?? "()";
          const retNode = inner.childForFieldName("return_type");
          exports.push({
            kind: "fn",
            name,
            detail: truncate(params, 60),
            returns: retNode ? truncate(retNode.text, 30) : void 0
          });
        }
      }
      if (inner?.type === "class_definition") {
        extractPythonClass(inner, exports);
      }
    }
    if (node.type === "class_definition") {
      extractPythonClass(node, exports);
    }
  }
}
function extractPythonClass(node, exports) {
  const name = node.childForFieldName("name")?.text ?? "";
  if (name.startsWith("_")) return;
  exports.push({ kind: "class", name, detail: "" });
  const body = node.childForFieldName("body");
  if (!body) return;
  for (const member of body.namedChildren) {
    let funcNode = member;
    if (member.type === "decorated_definition") {
      funcNode = member.namedChildren.find((c) => c.type === "function_definition");
      if (!funcNode) continue;
    }
    if (funcNode.type !== "function_definition") continue;
    const mName = funcNode.childForFieldName("name")?.text ?? "";
    if (mName.startsWith("_")) continue;
    const mParams = funcNode.childForFieldName("parameters")?.text ?? "()";
    const cleanParams = mParams.replace(/\(\s*self\s*,?\s*/, "(").replace(/\(\s*\)/, "()");
    const mRet = funcNode.childForFieldName("return_type");
    exports.push({
      kind: "method",
      name: mName,
      detail: truncate(cleanParams, 50),
      returns: mRet ? truncate(mRet.text, 30) : void 0,
      parent: name
    });
  }
}
function extractGo(root, exports) {
  for (const node of root.children) {
    if (node.type === "function_declaration") {
      const name = node.childForFieldName("name")?.text ?? "";
      if (!isGoExported(name)) continue;
      const params = node.childForFieldName("parameters")?.text ?? "()";
      const result = node.childForFieldName("result");
      exports.push({
        kind: "fn",
        name,
        detail: truncate(params, 60),
        returns: result ? truncate(result.text, 30) : void 0
      });
    }
    if (node.type === "method_declaration") {
      const name = node.childForFieldName("name")?.text ?? "";
      if (!isGoExported(name)) continue;
      const receiver = node.childForFieldName("receiver")?.text ?? "";
      const params = node.childForFieldName("parameters")?.text ?? "()";
      const result = node.childForFieldName("result");
      const recType = receiver.match(/\*?(\w+)/)?.[1] ?? "";
      exports.push({
        kind: "method",
        name,
        detail: truncate(params, 50),
        returns: result ? truncate(result.text, 30) : void 0,
        parent: recType
      });
    }
    if (node.type === "type_declaration") {
      for (const spec of node.namedChildren) {
        if (spec.type !== "type_spec") continue;
        const name = spec.childForFieldName("name")?.text ?? "";
        if (!isGoExported(name)) continue;
        const typeNode = spec.childForFieldName("type");
        if (typeNode?.type === "struct_type") {
          const fields = [];
          for (const field of typeNode.namedChildren) {
            if (fields.length >= 8) break;
            if (field.type === "field_declaration") {
              const fName = field.childForFieldName("name")?.text;
              const fType = field.childForFieldName("type")?.text;
              if (fName && fType && isGoExported(fName)) {
                fields.push(`${fName}: ${truncate(fType, 30)}`);
              }
            }
          }
          exports.push({ kind: "type", name, detail: "", fields });
        } else if (typeNode?.type === "interface_type") {
          const fields = [];
          for (const method of typeNode.namedChildren) {
            if (fields.length >= 8) break;
            if (method.type === "method_elem") {
              fields.push(truncate(method.text, 50));
            }
          }
          exports.push({ kind: "type", name, detail: "", fields });
        } else {
          exports.push({ kind: "type", name, detail: "" });
        }
      }
    }
  }
}
function isGoExported(name) {
  return name.length > 0 && name[0] >= "A" && name[0] <= "Z";
}
function extractRust(root, exports) {
  walkRustNode(root, exports, null);
}
function walkRustNode(node, exports, implType) {
  for (const child of node.children) {
    if (child.type === "function_item") {
      const vis = child.children.find((c) => c.type === "visibility_modifier");
      if (!vis && !implType) continue;
      const name = child.childForFieldName("name")?.text ?? "";
      const params = child.childForFieldName("parameters")?.text ?? "()";
      const retNode = child.childForFieldName("return_type");
      if (implType) {
        exports.push({
          kind: "method",
          name,
          detail: truncate(params.replace(/&\s*self\s*,?\s*/, ""), 50),
          returns: retNode ? truncate(retNode.text, 30) : void 0,
          parent: implType
        });
      } else {
        exports.push({
          kind: "fn",
          name,
          detail: truncate(params, 60),
          returns: retNode ? truncate(retNode.text, 30) : void 0
        });
      }
    }
    if (child.type === "struct_item") {
      const vis = child.children.find((c) => c.type === "visibility_modifier");
      if (!vis) continue;
      const name = child.childForFieldName("name")?.text ?? "";
      const fields = [];
      const body = child.childForFieldName("body");
      if (body) {
        for (const field of body.namedChildren) {
          if (fields.length >= 8) break;
          if (field.type === "field_declaration") {
            const fName = field.childForFieldName("name")?.text;
            const fType = field.childForFieldName("type")?.text;
            if (fName && fType) fields.push(`${fName}: ${truncate(fType, 30)}`);
          }
        }
      }
      exports.push({ kind: "type", name, detail: "", fields });
    }
    if (child.type === "trait_item") {
      const vis = child.children.find((c) => c.type === "visibility_modifier");
      if (!vis) continue;
      const name = child.childForFieldName("name")?.text ?? "";
      exports.push({ kind: "type", name, detail: "" });
    }
    if (child.type === "impl_item") {
      const typeName = child.childForFieldName("type")?.text ?? "";
      const body = child.childForFieldName("body");
      if (body && typeName) {
        walkRustNode(body, exports, typeName);
      }
    }
  }
}
function cleanReturnType(text) {
  const cleaned = text.replace(/^:\s*/, "");
  return truncate(cleaned, 30);
}
async function extractExportsTreeSitter(content, ext) {
  const langName = LANG_MAP[ext];
  if (!langName) return null;
  const ready = await ensureInit();
  if (!ready) return null;
  const lang = await getLanguage(langName);
  if (!lang) return null;
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);
  const exports = extractFromTree(tree, langName);
  tree.delete();
  parser.delete();
  return exports.length > 0 ? exports : null;
}
export {
  extractExportsTreeSitter
};
//# sourceMappingURL=tree-sitter-BXDO3XWQ.js.map