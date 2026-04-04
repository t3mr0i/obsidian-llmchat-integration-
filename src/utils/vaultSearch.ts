import MiniSearch from "minisearch";
import type { App, TFile, EventRef } from "obsidian";
import { MarkdownView } from "obsidian";

/**
 * A single chunk from a vault note, split by heading.
 */
interface NoteChunk {
  /** Unique id: filepath#index */
  id: string;
  /** File path in the vault */
  path: string;
  /** Note title (basename) */
  title: string;
  /** Section heading (empty for content before first heading) */
  heading: string;
  /** The actual text content of this chunk */
  content: string;
  /** Tags from frontmatter and inline */
  tags: string;
}

/**
 * Lightweight RAG search over the entire Obsidian vault.
 * Uses MiniSearch (BM25-based) to index all markdown notes,
 * split into heading-level chunks for precise retrieval.
 *
 * - Incremental updates via vault events (create/modify/delete)
 * - Active note always prioritized in results
 * - Dynamic context budget based on provider
 */
export class VaultSearch {
  private index: MiniSearch<NoteChunk>;
  private app: App;
  private indexed = false;
  private indexing = false;
  /** Track mtime per file to skip unchanged files on full re-index */
  private fileMtimes = new Map<string, number>();
  /** Vault event refs for cleanup */
  private eventRefs: EventRef[] = [];

  constructor(app: App) {
    this.app = app;
    this.index = new MiniSearch<NoteChunk>({
      fields: ["title", "heading", "content", "tags"],
      storeFields: ["path", "title", "heading", "content"],
      searchOptions: {
        boost: { title: 3, heading: 2, tags: 2, content: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  /**
   * Build the full index and start listening for vault changes.
   */
  async ensureIndex(): Promise<void> {
    if (this.indexing) return;
    if (this.indexed) return;

    this.indexing = true;
    try {
      const files = this.app.vault.getMarkdownFiles();
      for (const file of files) {
        await this.indexFile(file);
      }
      this.indexed = true;
      this.registerVaultEvents();
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Listen for vault file changes and update the index incrementally.
   */
  private registerVaultEvents() {
    // File modified → re-index that file
    this.eventRefs.push(
      this.app.vault.on("modify", (file) => {
        if (file instanceof Object && "extension" in file && (file as TFile).extension === "md") {
          this.reindexFile(file as TFile);
        }
      })
    );

    // File created → index it
    this.eventRefs.push(
      this.app.vault.on("create", (file) => {
        if (file instanceof Object && "extension" in file && (file as TFile).extension === "md") {
          this.indexFile(file as TFile);
        }
      })
    );

    // File deleted → remove from index
    this.eventRefs.push(
      this.app.vault.on("delete", (file) => {
        this.removeFile(file.path);
      })
    );

    // File renamed → remove old, index new
    this.eventRefs.push(
      this.app.vault.on("rename", (file, oldPath) => {
        this.removeFile(oldPath);
        if (file instanceof Object && "extension" in file && (file as TFile).extension === "md") {
          this.indexFile(file as TFile);
        }
      })
    );
  }

  /**
   * Remove all chunks belonging to a file path.
   */
  private removeFile(path: string) {
    this.fileMtimes.delete(path);
    // MiniSearch doesn't support removing by field, so we discard and re-add
    // Use the stored document IDs pattern: path#0, path#1, etc.
    const toRemove = Array.from({ length: 100 }, (_, i) => `${path}#${i}`);
    for (const id of toRemove) {
      try {
        this.index.discard(id);
      } catch {
        break; // No more chunks for this file
      }
    }
  }

  /**
   * Re-index a single file (remove old chunks, add new ones).
   */
  private async reindexFile(file: TFile) {
    this.removeFile(file.path);
    await this.indexFile(file);
  }

  /**
   * Index a single file by splitting it into heading-level chunks.
   */
  private async indexFile(file: TFile): Promise<void> {
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch {
      return;
    }

    if (!content.trim()) return;

    this.fileMtimes.set(file.path, file.stat.mtime);

    const title = file.basename;
    const tags = this.extractTags(content);
    const chunks = this.splitByHeadings(content);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.text.trim()) continue;

      this.index.add({
        id: `${file.path}#${i}`,
        path: file.path,
        title,
        heading: chunk.heading,
        content: chunk.text,
        tags,
      });
    }
  }

  /**
   * Split markdown content into chunks by headings.
   */
  private static readonly MAX_CHUNK_CHARS = 2000;

  private splitByHeadings(content: string): { heading: string; text: string }[] {
    const lines = content.split("\n");
    const rawChunks: { heading: string; text: string }[] = [];
    let currentHeading = "";
    let currentLines: string[] = [];

    // Skip frontmatter
    let startIdx = 0;
    if (lines[0]?.trim() === "---") {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
          startIdx = i + 1;
          break;
        }
      }
    }

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,3})\s+(.+)/);

      if (headingMatch) {
        if (currentLines.length > 0) {
          rawChunks.push({ heading: currentHeading, text: currentLines.join("\n") });
        }
        currentHeading = headingMatch[2].trim();
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      rawChunks.push({ heading: currentHeading, text: currentLines.join("\n") });
    }

    // Split oversized chunks at paragraph boundaries
    const chunks: { heading: string; text: string }[] = [];
    for (const chunk of rawChunks) {
      if (chunk.text.length <= VaultSearch.MAX_CHUNK_CHARS) {
        chunks.push(chunk);
        continue;
      }

      // Split at double-newlines (paragraph breaks)
      const paragraphs = chunk.text.split(/\n\n+/);
      let buf = "";
      let partNum = 0;
      for (const para of paragraphs) {
        if (buf.length + para.length > VaultSearch.MAX_CHUNK_CHARS && buf.length > 0) {
          chunks.push({ heading: chunk.heading + (partNum > 0 ? ` (${partNum + 1})` : ""), text: buf.trim() });
          partNum++;
          buf = "";
        }
        buf += (buf ? "\n\n" : "") + para;
      }
      if (buf.trim()) {
        chunks.push({ heading: chunk.heading + (partNum > 0 ? ` (${partNum + 1})` : ""), text: buf.trim() });
      }
    }

    return chunks;
  }

  /**
   * Extract tags from frontmatter and inline tags.
   */
  private extractTags(content: string): string {
    const tags: string[] = [];

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const tagLine = fmMatch[1].match(/tags:\s*\[?([^\]\n]+)/);
      if (tagLine) {
        tags.push(...tagLine[1].split(",").map((t) => t.trim().replace(/^#/, "")));
      }
    }

    const inlineTags = content.match(/#[a-zA-Z][\w/-]*/g);
    if (inlineTags) {
      tags.push(...inlineTags.map((t) => t.replace(/^#/, "")));
    }

    return [...new Set(tags)].join(" ");
  }

  /**
   * Get the content of the currently active note.
   */
  private getActiveNoteContext(): { path: string; title: string; content: string } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return null;
    return {
      path: view.file.path,
      title: view.file.basename,
      content: view.editor.getValue(),
    };
  }

  /**
   * Search the vault for chunks relevant to a query.
   * Active note chunks are always boosted to the top.
   */
  async search(query: string, maxResults = 15): Promise<{
    path: string;
    title: string;
    heading: string;
    content: string;
    score: number;
  }[]> {
    await this.ensureIndex();

    const results = this.index.search(query, { limit: maxResults + 10 });

    const activeNote = this.getActiveNoteContext();
    const activePath = activeNote?.path;

    // Separate active note results and others
    const activeResults = results.filter((r) => r.path === activePath);
    const otherResults = results.filter((r) => r.path !== activePath);

    // Active note first, then by score
    const combined = [...activeResults, ...otherResults].slice(0, maxResults);

    return combined.map((r) => ({
      path: r.path as string,
      title: r.title as string,
      heading: r.heading as string,
      content: r.content as string,
      score: r.score,
    }));
  }

  /**
   * Build a context string from search results.
   * Always includes the active note (even if not in search results),
   * then fills remaining budget with relevant vault chunks.
   */
  async buildContext(query: string, maxChars = 12000, maxResults = 15): Promise<string> {
    const parts: string[] = [];
    let totalLength = 0;

    // 1. Always include active note (up to 30% of budget)
    const activeNote = this.getActiveNoteContext();
    if (activeNote && activeNote.content.trim()) {
      const activeBudget = Math.floor(maxChars * 0.3);
      const activeContent = activeNote.content.length > activeBudget
        ? activeNote.content.slice(0, activeBudget) + "\n[... rest of active note omitted]"
        : activeNote.content;

      const activeBlock = `=== Active note: ${activeNote.title} (${activeNote.path}) ===\n${activeContent}\n`;
      parts.push(activeBlock);
      totalLength += activeBlock.length;
    }

    // 2. Fill remaining budget with RAG results
    const results = await this.search(query, maxResults);
    const ragResults = activeNote
      ? results.filter((r) => r.path !== activeNote.path)
      : results;

    if (ragResults.length > 0) {
      const ragHeader = "\n=== Related notes from vault ===\n";
      parts.push(ragHeader);
      totalLength += ragHeader.length;

      for (const r of ragResults) {
        const header = `--- ${r.title}${r.heading ? " > " + r.heading : ""} ---`;
        const chunk = r.content.length > 2000
          ? r.content.slice(0, 2000) + "\n[...]"
          : r.content;

        const entry = header + "\n" + chunk + "\n";

        if (totalLength + entry.length > maxChars) break;

        parts.push(entry);
        totalLength += entry.length;
      }
    }

    if (parts.length === 0) return "";

    parts.push("=== End of vault context ===");
    return parts.join("\n");
  }

  /**
   * Clean up event listeners.
   */
  destroy() {
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];
  }

  get documentCount(): number {
    return this.index.documentCount;
  }
}
