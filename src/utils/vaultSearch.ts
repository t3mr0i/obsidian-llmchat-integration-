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
 * Performance optimizations:
 * - Batch indexing via requestIdleCallback (non-blocking)
 * - Debounced file re-indexing (avoids thrashing on auto-save)
 * - Chunk count tracking per file (no 100-iteration removal loops)
 * - Content stored in separate Map (not duplicated in MiniSearch index)
 */
export class VaultSearch {
  private readonly index: MiniSearch<NoteChunk>;
  private readonly app: App;
  private indexed = false;
  private indexing = false;
  /** Track chunk count per file for efficient removal */
  private readonly fileChunkCounts = new Map<string, number>();
  /** Store chunk content separately to avoid doubling RAM in MiniSearch */
  private readonly chunkContent = new Map<string, string>();
  /** Vault event refs for cleanup */
  private eventRefs: EventRef[] = [];
  /** Debounce timers for modify events */
  private modifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Pending index promise for callers to await */
  private indexPromise: Promise<void> | null = null;

  private static readonly MAX_CHUNK_CHARS = 2000;
  private static readonly MODIFY_DEBOUNCE_MS = 1000;

  constructor(app: App) {
    this.app = app;
    this.index = new MiniSearch<NoteChunk>({
      fields: ["title", "heading", "content", "tags"],
      // Don't store content in MiniSearch — we keep it in chunkContent Map
      storeFields: ["path", "title", "heading"],
      searchOptions: {
        boost: { title: 3, heading: 2, tags: 2, content: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  /**
   * Build the full index and start listening for vault changes.
   * Non-blocking: indexes in batches via requestIdleCallback.
   */
  async ensureIndex(): Promise<void> {
    if (this.indexed) return;
    if (this.indexPromise) return this.indexPromise;

    this.indexPromise = this.doBatchIndex();
    return this.indexPromise;
  }

  private async doBatchIndex(): Promise<void> {
    this.indexing = true;
    try {
      const files = this.app.vault.getMarkdownFiles();
      const BATCH_SIZE = 50;

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        for (const file of batch) {
          await this.indexFile(file);
        }
        // Yield to main thread between batches
        if (i + BATCH_SIZE < files.length) {
          await this.yieldToMain();
        }
      }

      this.indexed = true;
      this.registerVaultEvents();
    } finally {
      this.indexing = false;
      this.indexPromise = null;
    }
  }

  /**
   * Yield control back to the main thread to prevent UI freezing.
   */
  private yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(() => resolve(), { timeout: 100 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  /**
   * Listen for vault file changes and update the index incrementally.
   */
  private registerVaultEvents() {
    const isMd = (file: unknown): file is TFile =>
      file instanceof Object && "extension" in file && (file as TFile).extension === "md";

    // File modified → debounced re-index
    this.eventRefs.push(
      this.app.vault.on("modify", (file) => {
        if (!isMd(file)) return;
        this.debouncedReindex(file);
      })
    );

    // File created → index it
    this.eventRefs.push(
      this.app.vault.on("create", (file) => {
        if (isMd(file)) this.indexFile(file);
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
        if (isMd(file)) this.indexFile(file);
      })
    );
  }

  /**
   * Debounce re-indexing to avoid thrashing on rapid saves (e.g., auto-save).
   */
  private debouncedReindex(file: TFile) {
    const existing = this.modifyTimers.get(file.path);
    if (existing) clearTimeout(existing);

    this.modifyTimers.set(
      file.path,
      setTimeout(() => {
        this.modifyTimers.delete(file.path);
        this.reindexFile(file);
      }, VaultSearch.MODIFY_DEBOUNCE_MS)
    );
  }

  /**
   * Remove all chunks belonging to a file path.
   * Uses tracked chunk count instead of guessing up to 100.
   */
  private removeFile(path: string) {
    const count = this.fileChunkCounts.get(path) ?? 0;
    for (let i = 0; i < count; i++) {
      const id = `${path}#${i}`;
      try {
        this.index.discard(id);
      } catch {
        // Already removed or doesn't exist
      }
      this.chunkContent.delete(id);
    }
    this.fileChunkCounts.delete(path);
    // Cancel any pending debounce
    const timer = this.modifyTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      this.modifyTimers.delete(path);
    }
  }

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

    const title = file.basename;
    const tags = this.extractTags(content);
    const chunks = this.splitByHeadings(content);

    let chunkCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.text.trim()) continue;

      const id = `${file.path}#${i}`;
      this.index.add({
        id,
        path: file.path,
        title,
        heading: chunk.heading,
        content: chunk.text,
        tags,
      });
      // Store content separately
      this.chunkContent.set(id, chunk.text);
      chunkCount = i + 1;
    }
    this.fileChunkCounts.set(file.path, chunkCount);
  }

  /**
   * Split markdown content into chunks by headings.
   * Oversized sections are split at paragraph boundaries.
   */
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
      const headingMatch = /^(#{1,3})\s+(.+)/.exec(line);

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

      const paragraphs = chunk.text.split(/\n\n+/);
      let buf = "";
      let partNum = 0;
      for (const para of paragraphs) {
        if (buf.length + para.length > VaultSearch.MAX_CHUNK_CHARS && buf.length > 0) {
          const suffix = partNum > 0 ? ` (${partNum + 1})` : "";
          chunks.push({ heading: chunk.heading + suffix, text: buf.trim() });
          partNum++;
          buf = "";
        }
        buf += (buf ? "\n\n" : "") + para;
      }
      if (buf.trim()) {
        const suffix = partNum > 0 ? ` (${partNum + 1})` : "";
        chunks.push({ heading: chunk.heading + suffix, text: buf.trim() });
      }
    }

    return chunks;
  }

  /**
   * Extract tags from frontmatter and inline tags.
   */
  private extractTags(content: string): string {
    const tags: string[] = [];

    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
    if (fmMatch) {
      const tagLine = /tags:\s*\[?([^\]\n]+)/.exec(fmMatch[1]);
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

    const results = this.index.search(query).slice(0, maxResults + 10);

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
      heading: (r.heading as string) ?? "",
      // Retrieve content from our Map (not stored in MiniSearch)
      content: this.chunkContent.get(r.id) ?? "",
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
    if (activeNote?.content.trim()) {
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
   * Clean up event listeners and timers.
   */
  destroy() {
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];

    // Clear debounce timers
    for (const timer of this.modifyTimers.values()) {
      clearTimeout(timer);
    }
    this.modifyTimers.clear();

    // Free content memory
    this.chunkContent.clear();
    this.fileChunkCounts.clear();
  }

  get documentCount(): number {
    return this.index.documentCount;
  }
}
