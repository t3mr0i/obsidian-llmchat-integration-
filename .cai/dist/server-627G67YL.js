#!/usr/bin/env node
import {
  estimateTokens,
  stripFrontmatter
} from "./chunk-TBA32Z4B.js";
import {
  findScaffoldFiles,
  runDriftCheck
} from "./chunk-QSCBXJG5.js";
import {
  scanProjectModel
} from "./chunk-S2JQZXY2.js";
import {
  appendQuery
} from "./chunk-XAVW3U2U.js";
import "./chunk-WX2YGCKP.js";

// src/mcp/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync, statSync } from "fs";
import { join, relative } from "path";
var ScaffoldCache = class {
  constructor(projectRoot, scaffoldRoot) {
    this.projectRoot = projectRoot;
    this.scaffoldRoot = scaffoldRoot;
  }
  fileList = [];
  files = /* @__PURE__ */ new Map();
  lastGlobMs = 0;
  GLOB_TTL_MS = 3e4;
  /** Get cached file list, re-globbing at most every 30s */
  getFileList() {
    const now = Date.now();
    if (now - this.lastGlobMs > this.GLOB_TTL_MS || this.fileList.length === 0) {
      this.fileList = findScaffoldFiles(this.projectRoot, this.scaffoldRoot);
      this.lastGlobMs = now;
    }
    return this.fileList;
  }
  /** Get file content (stripped of frontmatter), using mtime-based cache */
  getFile(absPath) {
    let mtimeMs;
    try {
      mtimeMs = statSync(absPath).mtimeMs;
    } catch {
      return { raw: "", stripped: "", tokens: 0, mtimeMs: 0 };
    }
    const cached = this.files.get(absPath);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    let raw;
    try {
      raw = readFileSync(absPath, "utf8");
    } catch {
      raw = "";
    }
    const stripped = stripFrontmatter(raw);
    const entry = { raw, stripped, tokens: estimateTokens(stripped), mtimeMs };
    this.files.set(absPath, entry);
    return entry;
  }
  /** Force re-glob and clear file cache (for drift checks that need fresh data) */
  invalidate() {
    this.fileList = [];
    this.files.clear();
    this.lastGlobMs = 0;
  }
};
function extractHeadings(content) {
  return content.split("\n").filter((line) => /^#{1,6}\s/.test(line)).join("\n");
}
function extractSummary(content) {
  const lines = content.split("\n");
  const out = [];
  let inSection = false;
  let firstLineAdded = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      out.push(line);
      inSection = true;
      firstLineAdded = false;
    } else if (inSection && !firstLineAdded && line.trim().length > 0) {
      out.push(line);
      firstLineAdded = true;
    }
  }
  return out.join("\n");
}
function extractSection(content, sectionName) {
  const lines = content.split("\n");
  const lower = sectionName.toLowerCase();
  let capturing = false;
  let captureLevel = 0;
  const out = [];
  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (capturing) {
        if (level <= captureLevel) break;
      }
      if (!capturing && title.toLowerCase().includes(lower)) {
        capturing = true;
        captureLevel = level;
      }
    }
    if (capturing) out.push(line);
  }
  return out.join("\n").trim();
}
function searchScaffold(scaffoldFiles, projectRoot, query, cache, limit = 5) {
  const results = [];
  const q = query.toLowerCase();
  for (const absPath of scaffoldFiles) {
    const { raw: content } = cache.getFile(absPath);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 2);
        results.push({
          file: relative(projectRoot, absPath),
          excerpt: lines.slice(start, end + 1).join("\n"),
          line: i + 1
        });
        if (results.length >= limit) break;
      }
    }
    if (results.length >= limit) break;
  }
  return results;
}
function getDynamicTools(project) {
  const tools = [];
  if (project.rootManifest?.type === "package.json" && project.commands.length > 0) {
    tools.push({
      name: "cai_project_commands",
      description: `List all ${project.commands.length} available project commands (npm scripts, make targets). Use this to find the right command before running anything.`,
      inputSchema: { type: "object", properties: {} }
    });
  }
  if (project.workspaces.length > 1) {
    tools.push({
      name: "cai_workspace_map",
      description: `Navigate this monorepo's ${project.workspaces.length} workspaces. Returns workspace names, paths, and internal dependency graph.`,
      inputSchema: { type: "object", properties: {} }
    });
  }
  return tools;
}
function handleDynamicTool(name, project) {
  if (name === "cai_project_commands") {
    const commands = project.commands;
    if (commands.length === 0) return "No commands found in project manifests.";
    const rows = commands.map((c) => `- \`${c}\``).join("\n");
    return `## Project Commands (${commands.length})

${rows}`;
  }
  if (name === "cai_workspace_map") {
    if (project.workspaces.length === 0) return "No workspaces detected.";
    const lines = [`## Workspaces (${project.workspaces.length})
`];
    for (const ws of project.workspaces) {
      const wsName = ws.manifest.name ?? ws.path;
      const deps = project.workspaceDependencies.filter((d) => d.from === ws.path).map((d) => d.to);
      const depStr = deps.length > 0 ? ` \u2192 depends on: ${deps.join(", ")}` : "";
      lines.push(`- **${wsName}** (\`${ws.path}\`)${depStr}`);
    }
    return lines.join("\n");
  }
  return null;
}
async function startMcpServer(config) {
  const { projectRoot, scaffoldRoot } = config;
  const cache = new ScaffoldCache(projectRoot, scaffoldRoot);
  const projectModel = scanProjectModel(projectRoot);
  const server = new Server(
    { name: "cai", version: "1.0.0" },
    { capabilities: { resources: {}, tools: {} } }
  );
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const files = cache.getFileList();
    return {
      resources: files.map((absPath) => {
        const rel = relative(projectRoot, absPath);
        const { tokens } = cache.getFile(absPath);
        return {
          uri: `cai://scaffold/${rel}`,
          name: rel,
          description: `Scaffold file (~${tokens} tokens)`,
          mimeType: "text/markdown"
        };
      })
    };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (!uri.startsWith("cai://scaffold/")) {
      throw new Error(`Unknown resource URI: ${uri}`);
    }
    const rel = uri.slice("cai://scaffold/".length);
    const absPath = join(projectRoot, rel);
    if (!existsSync(absPath)) {
      throw new Error(`Scaffold file not found: ${rel}`);
    }
    const { stripped } = cache.getFile(absPath);
    return {
      contents: [{ uri, mimeType: "text/markdown", text: stripped }]
    };
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "cai_list_context",
        description: "START HERE. List all project context files with token costs. Call this first to see what documentation exists before reading files or answering architecture questions.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "cai_get_context",
        description: "Read a project context file. Use mode='summary' (~10% tokens) or 'headings' (~3%) first. Only use mode='full' when you need exact details. Covers: architecture, conventions, tech stack, setup, decisions.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path from cai_list_context output (e.g. '.cai/context/architecture.md')"
            },
            mode: {
              type: "string",
              enum: ["full", "summary", "headings"],
              description: "'headings': structure only (~3% tokens). 'summary': headings + first line (~10%). 'full': entire file (100%)."
            },
            section: {
              type: "string",
              description: "Optional heading to extract (e.g. 'Key Components'). Returns only that section. Saves tokens when you need one specific part."
            }
          },
          required: ["path"]
        }
      },
      {
        name: "cai_search",
        description: "Search all project documentation for a keyword or topic. Returns matching excerpts with file and line number. Use this instead of loading full files when you need a specific fact (e.g. 'auth flow', 'database schema', 'deploy').",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Keyword or phrase to search for" },
            limit: {
              type: "number",
              description: "Max results (default 5)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "cai_check_drift",
        description: "Verify project docs match actual codebase. Returns drift score and issues. Run this before making architectural changes or when you suspect docs are outdated.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "cai_pattern_suggest",
        description: "Suggest patterns from the user's global pattern library that match this project's stack and dependencies. Call this BEFORE starting a new task \u2014 if a relevant pattern exists, follow it instead of improvising. Returns up to 5 patterns ranked by stack and dependency overlap.",
        inputSchema: { type: "object", properties: {} }
      },
      ...getDynamicTools(projectModel)
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const result = await handleToolCall(name, args);
    const filePath = args?.path ?? args?.file;
    const responseText = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    appendQuery(projectRoot, {
      tool: name,
      file: filePath,
      tokens: estimateTokens(responseText)
    });
    return result;
  });
  async function handleToolCall(name, args) {
    if (name === "cai_list_context") {
      const files = cache.getFileList();
      const rows = files.map((absPath) => {
        const rel = relative(projectRoot, absPath);
        const { tokens } = cache.getFile(absPath);
        const hint = tokens >= 3e3 ? " \u26A0 large" : tokens >= 1500 ? " \xB7 medium" : " \xB7 small";
        return `${rel.padEnd(40)} ~${tokens} tokens${hint}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `${rows.join("\n")}`
          }
        ]
      };
    }
    if (name === "cai_get_context") {
      const { path, mode = "full", section } = args;
      const absPath = join(projectRoot, path);
      if (!existsSync(absPath)) {
        return { content: [{ type: "text", text: `File not found: ${path}` }] };
      }
      const { stripped: rawContent } = cache.getFile(absPath);
      let content;
      let modeLabel;
      if (section) {
        content = extractSection(rawContent, section);
        modeLabel = content ? `section: ${section}` : "section not found";
        if (!content) {
          const headings = extractHeadings(rawContent);
          content = `Section "${section}" not found. Available headings:
${headings}`;
        }
      } else if (mode === "headings") {
        content = extractHeadings(rawContent);
        modeLabel = "headings only";
      } else if (mode === "summary") {
        content = extractSummary(rawContent);
        modeLabel = "summary";
      } else {
        content = rawContent;
        modeLabel = "full";
      }
      return {
        content: [
          {
            type: "text",
            text: `# ${path} [${modeLabel}]

${content}`
          }
        ]
      };
    }
    if (name === "cai_search") {
      const { query, limit } = args;
      const files = cache.getFileList();
      const results = searchScaffold(files, projectRoot, query, cache, limit ?? 5);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No results for "${query}" in scaffold files.` }]
        };
      }
      const formatted = results.map((r) => `**${r.file}:${r.line}**
\`\`\`
${r.excerpt}
\`\`\``).join("\n\n");
      return {
        content: [
          {
            type: "text",
            text: formatted
          }
        ]
      };
    }
    if (name === "cai_pattern_suggest") {
      try {
        const { findMatching } = await import("./matching-QQS2CJGZ.js");
        const matches = findMatching(projectModel).slice(0, 5);
        if (matches.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No matching patterns in the user's pattern library.\nIf this kind of task recurs, suggest the user share a pattern with: cai pattern share <name>"
            }]
          };
        }
        const lines = [`Found ${matches.length} matching pattern${matches.length !== 1 ? "s" : ""}:`, ""];
        for (const m of matches) {
          lines.push(`**${m.entry.name}** (score ${m.score})`);
          lines.push(`  ${m.entry.description}`);
          if (m.reasons.length > 0) lines.push(`  \u2192 ${m.reasons.join(" \xB7 ")}`);
          lines.push(`  Install with: cai pattern install ${m.entry.hash}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Pattern suggest failed: ${err.message}` }]
        };
      }
    }
    if (name === "cai_check_drift") {
      cache.invalidate();
      const report = await runDriftCheck(config);
      const errors = report.issues.filter((i) => i.severity === "error").length;
      const warnings = report.issues.filter((i) => i.severity === "warning").length;
      const summary = report.score === 100 ? "Scaffold is fully in sync \u2014 no drift detected." : `Drift score: ${report.score}/100. ${errors} error${errors !== 1 ? "s" : ""}, ${warnings} warning${warnings !== 1 ? "s" : ""}.`;
      const issues = report.issues.slice(0, 20).map((i) => `[${i.severity}] ${i.file}: ${i.message} (${i.code})`).join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${summary}

${issues || "No issues."}`
          }
        ]
      };
    }
    const dynamicResult = handleDynamicTool(name, projectModel);
    if (dynamicResult !== null) {
      return { content: [{ type: "text", text: dynamicResult }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
export {
  startMcpServer
};
//# sourceMappingURL=server-627G67YL.js.map