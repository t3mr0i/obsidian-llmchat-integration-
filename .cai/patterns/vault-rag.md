---
name: vault-rag
description: Working with VaultSearch — MiniSearch index, heading-chunked content, debounced re-indexing.
triggers:
  - "vault search"
  - "minisearch"
  - "rag"
  - "note autocomplete"
  - "context retrieval"
  - "chunk"
edges:
  - target: ../context/architecture.md
    condition: when wiring VaultSearch into a new view or feature
  - target: ../context/decisions.md
    condition: when you need the rationale for chunk size, debounce, separate content map
last_updated: 2026-04-07
---

# Vault RAG (VaultSearch)

## Anchor — relevant code

`src/utils/vaultSearch.ts`:

```ts
export class VaultSearch {
  private readonly index: MiniSearch<NoteChunk>;
  private readonly fileChunkCounts = new Map<string, number>();
  /** Store chunk content separately to avoid doubling RAM in MiniSearch */
  private readonly chunkContent = new Map<string, string>();
  private static readonly MAX_CHUNK_CHARS = 2000;
  private static readonly MODIFY_DEBOUNCE_MS = 1000;

  constructor(app: App) {
    this.index = new MiniSearch<NoteChunk>({
      fields: ["title", "heading", "content", "tags"],
      // Don't store content in MiniSearch — we keep it in chunkContent Map
      storeFields: ["path", "title", "heading"],
      searchOptions: { boost: { title: 3, heading: 2, tags: 2, content: 1 } },
    });
  }
}
```

## Context

`VaultSearch` is the project's RAG layer over the entire Obsidian vault. It exists because of a hard rule: **never truncate content sent to the LLM**. If a payload would be too large, retrieve relevant chunks instead.

Key design choices (see `decisions.md`):
- Chunks are split at heading boundaries, hard-capped at 2000 chars.
- Indexing is batched via `requestIdleCallback` so it never blocks the UI.
- File modify events are debounced 1s — Obsidian fires modify on every auto-save tick.
- Content is kept in a separate `Map`, not in MiniSearch's `storeFields`, because `storeFields` are kept in memory and would double RAM use across the vault.

## Steps

To **use VaultSearch** in a new feature:

1. Construct one per consumer (currently `ChatView` owns one). Constructor is `new VaultSearch(plugin.app)`.
2. Wait for `index.indexAll()` (or whatever the public init method is — check the file) before searching. The promise is cached internally; calling repeatedly is safe.
3. Search via the public search method. Results come back as `NoteChunk` lite objects (`path`, `title`, `heading`); fetch the actual content from the `chunkContent` Map via the chunk `id`.
4. On view close, dispose: detach event refs and clear maps. The class registers vault event listeners — leaking them is a real bug source.

To **change chunking behavior**:

1. `MAX_CHUNK_CHARS` is the only knob worth touching. Increasing it improves single-shot recall but hurts retrieval precision and balloons memory.
2. If you change the chunking algorithm, you must also bump any persisted index version (currently the index is rebuilt on plugin load — no on-disk persistence — so this is moot but worth knowing).

To **react to file changes**: do not register your own modify listeners against the same files. Hook into `VaultSearch`'s lifecycle or expose a callback. Two debounce timers fighting over the same file is a known foot-gun.

## Gotchas

- **`chunkContent` is not in MiniSearch.** If you naively call `index.search()` and try to read `result.content`, you will get `undefined`. Look it up in the `chunkContent` Map by the chunk `id` (`filepath#index`).
- **`storeFields` ≠ index fields.** `fields` are searched, `storeFields` are returned. We deliberately exclude `content` from both lists.
- **Boost values** (`title:3, heading:2, tags:2, content:1`) make title hits dominate. Don't lower the title boost without testing real queries — note name matches are usually what users want.
- **Re-indexing thrashing:** if you bypass the debounce, every keystroke during auto-save will tear down and rebuild the chunks for that file. Always go through the debounced modify handler.
- **Initial indexing on a 10k-note vault is slow.** It runs in idle callbacks, so it's invisible, but a search issued during the first few seconds may return partial results. Either await `indexAll` or accept incomplete results.

## Verify

- [ ] Search results contain expected files for a known query (try the plugin against your dev vault).
- [ ] Modifying a file does not produce more than one re-index within `MODIFY_DEBOUNCE_MS`.
- [ ] No memory growth across many file modifies (chunks are removed via `fileChunkCounts`, not by 100-iteration loops).
- [ ] Event refs are cleaned up on view close (`unregisterEvent` or equivalent).

## Debug

- Empty results: confirm `indexAll()` finished. Add a `console.log(this.fileChunkCounts.size)` after init.
- Stale results: a rename or delete didn't propagate. Check the vault event handlers in `VaultSearch` cover `rename`, `delete`, and `create` — not just `modify`.
- RAM blowup: confirm `content` is **not** in `storeFields` and that `chunkContent.delete(id)` runs on file removal.

## After This Task
- [ ] If the public API of `VaultSearch` changed, note it in `.cai/context/architecture.md`.
- [ ] Don't change the chunk format without updating `.cai/context/decisions.md`.
