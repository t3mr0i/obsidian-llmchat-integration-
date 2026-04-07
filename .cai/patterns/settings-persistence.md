---
name: settings-persistence
description: How to add new settings or persisted state without clobbering Obsidian Sync changes from another device. Always-required when touching data.json.
triggers:
  - "settings"
  - "persistence"
  - "data.json"
  - "save"
  - "migration"
edges:
  - target: context/conventions.md
    condition: when reviewing the verify checklist for a settings change
  - target: context/decisions.md
    condition: when justifying why mergeBeforeSave exists
last_updated: 2026-04-07
---

# Add or change persisted plugin state

## Anchor

`main.ts` — `mergeBeforeSave` re-reads the plugin data file from disk and merges per-provider
configs and chat sessions, so settings written by another device via Obsidian Sync survive:

```ts
private async mergeBeforeSave(): Promise<Record<string, unknown>> {
  const disk = (await this.loadData()) as any ?? {};
  // Merge provider configs: in-memory wins per-field, but keep extra disk keys
  const mergedProviders: Record<string, ProviderConfig> = {};
  const allProviderKeys = new Set([
    ...Object.keys(this.settings.providers ?? {}),
    ...Object.keys(disk.providers ?? {}),
  ]);
  for (const key of allProviderKeys) {
    const mem = (this.settings.providers as Record<string, ProviderConfig>)[key];
    const ext = (disk.providers as Record<string, ProviderConfig> | undefined)?.[key];
    if (mem && ext) {
      mergedProviders[key] = { ...ext, ...mem };
    } else {
      mergedProviders[key] = mem ?? ext;
    }
  }
  // ... merge chat sessions by id ...
  return { ...disk, ...this.settings, providers: mergedProviders, _chatSessions: mergedSessions };
}
```

## Context

Read `context/decisions.md` → "Cloud-sync-safe `mergeBeforeSave`" and the
`feedback_merge_not_overwrite` user memory. The principle is: **the plugin data file is shared
state**, not exclusively ours. We must always read-then-write, never just write.

## Steps

### Add a new top-level setting
1. Add the field to `LLMPluginSettings` in `src/types.ts`.
2. Add a default to `DEFAULT_SETTINGS` (also in `src/types.ts`).
3. If older saved data may not have the field, add an in-place migration in
   `LLMPlugin.loadSettings` (`main.ts`) next to the existing migrations.
4. Add UI for it in `src/settings/SettingsTab.ts`.
5. Always save via `await this.plugin.saveSettings()` — never call `saveData` directly.

### Add a new per-provider setting
1. Add the field to `ProviderConfig` in `src/types.ts`.
2. If a provider needs a non-default value, set it in `DEFAULT_PROVIDER_CONFIGS`.
3. The merge in `mergeBeforeSave` already handles per-provider field merging — no new
   code needed there.
4. Add UI in the relevant section of `SettingsTab.ts`.

### Add new persisted state next to settings (e.g. another `_xxx` key)
1. Mirror the `_chatSessions` pattern: store under a leading-underscore key alongside
   settings in the returned object from `mergeBeforeSave`.
2. Add a merge step in `mergeBeforeSave` that reconciles disk vs in-memory by id (or by
   whatever uniqueness key applies).
3. Provide a `saveXxx` method on `LLMPlugin` that uses the lightweight save path
   (`saveChatSessions` is the template) or the merge path, depending on whether the data
   could conflict with another device.

## Gotchas

- **Calling `saveData(this.settings)` directly bypasses the merge** and silently destroys
  remote changes the user made on another device. Always go through `saveSettings` or a
  dedicated `saveXxx` that re-reads disk.
- **The lightweight `saveChatSessions` path skips full merge** (see comment in
  `main.ts`). It is safe only because chat sessions are written exclusively from this
  device's view. Do not use it for state that can change remotely.
- **Migrations must be idempotent.** They run on every `loadSettings`. Don't push to an
  array unconditionally.
- **`Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {})`** in `loadSettings` does a
  shallow merge — nested objects (e.g. per-provider) won't gain new default fields
  automatically. If you add a nested field, write an explicit migration.

## Verify

- [ ] Save the setting, edit the plugin data file on disk to add an unrelated key, save again from
      the plugin, check that the unrelated key survived.
- [ ] Save the setting on device A while a different value exists on disk (simulate
      Obsidian Sync), confirm the disk value is preserved when not touched in memory.
- [ ] Reload the plugin and confirm the setting comes back.
- [ ] Migration runs only when needed (no warning toast on a fresh install or repeated
      reload).

## Debug

- `console.log(await this.loadData())` in `loadSettings` to see what arrived on disk.
- Diff the plugin data file before and after a save to confirm only intended keys changed.
- If a setting "disappeared", search the codebase for any direct `saveData(` call —
  there should be none outside `mergeBeforeSave` and the lightweight `saveChatSessions`.

## After This Task
- [ ] Update `.cai/ROUTER.md` "Current Project State" if the new state changes capability.
- [ ] Update `.cai/context/architecture.md` if you added a new top-level persisted key.
