---
name: settings-persistence
description: How to read/write plugin settings and chat sessions safely with cloud-sync-aware merge.
triggers:
  - "save settings"
  - "data.json"
  - "loadData"
  - "saveData"
  - "merge"
  - "cloud sync"
edges:
  - target: ../context/decisions.md
    condition: when you need to know why merge-on-save exists
  - target: ../context/conventions.md
    condition: when adding a new settings field and need to follow the rules
last_updated: 2026-04-07
---

# Settings Persistence

## Anchor — relevant code

`main.ts` (`LLMPlugin`):

```ts
async saveSettings() {
  const merged = await this.mergeBeforeSave();
  await this.saveData(merged);
  this.executor?.updateSettings(this.settings);
  this.updateStatusBar();
}

async saveChatSessions(sessions: ChatSession[]) {
  this.chatSessions = sessions;
  // Skip full merge for session saves — sessions are only modified locally,
  // so a lightweight save is sufficient and avoids extra disk reads.
  await this.saveData({ ...this.settings, _chatSessions: this.chatSessions });
}

private async mergeBeforeSave(): Promise<Record<string, unknown>> {
  const disk = (await this.loadData()) as any ?? {};
  // …merges providers field-by-field, prefers in-memory but keeps unknown disk keys…
  // …merges chat sessions by id, preferring the version with most messages…
}
```

## Context

`data.json` lives inside the user's vault and may be **synced across devices** via Obsidian Sync, iCloud, Syncthing, or Dropbox. A naïve `saveData(this.settings)` would overwrite changes made on the other device since this device last loaded.

There are **two write paths**:

1. **Settings writes (`saveSettings`)** — go through `mergeBeforeSave`, which re-reads `data.json` and merges providers/chat sessions before writing. Slower but safe across devices.
2. **Session writes (`saveChatSessions`)** — bypass the merge. Sessions are only ever modified locally inside this `ChatView`, and the merge cost on every keystroke would be wasteful.

## Steps

To **add a new settings field**:

1. Add the field to `LLMPluginSettings` in `src/types.ts` and supply a default in `DEFAULT_SETTINGS`.
2. If the shape of an existing field changes, add a migration in `LLMPlugin.loadSettings()` (look at how `systemPrompt` string → file migration is handled, or how `defaultTimeout` is back-filled).
3. UI to flip the field goes in `SettingsTab.ts`. The handler **must call `await this.plugin.saveSettings()`** — never `saveData` directly.
4. If the field is per-provider, add it to `ProviderConfig` and the merge in `mergeBeforeSave` will pick it up automatically (it merges providers field-by-field).

To **read settings** in a new module: import `LLMPluginSettings` from `src/types.ts` and accept it via constructor. Don't reach back to `LLMPlugin.app` for it.

## Gotchas

- **The `_chatSessions` key is intentional.** It's stored alongside settings in the same `data.json`. Any write that goes through `mergeBeforeSave` re-merges it; the fast `saveChatSessions` path also preserves it because it spreads `this.settings` first.
- **Don't call `saveData(this.settings)` from a feature path.** If you need a fast save, copy the `saveChatSessions` pattern, otherwise use `saveSettings`.
- **Migrations are silent — they just patch the in-memory object.** They do not call `saveData`. The next normal save flushes the migration.
- **The merge prefers in-memory per field but keeps unknown disk keys.** This is how forward compatibility works: an older client opening a `data.json` written by a newer client will not destroy the new keys.
- **Chat session merge prefers the version with more messages.** If both devices appended different turns to the same session id, you'll get the longer one — the other branch is lost. (Acceptable trade-off; sessions are not collaborative documents.)

## Verify

- [ ] No new direct `saveData(...)` call in your diff (`grep -n "saveData(" main.ts src/`).
- [ ] Settings UI handlers `await this.plugin.saveSettings()`.
- [ ] If you added a new top-level setting, it has a default in `DEFAULT_SETTINGS` and survives a load → save → load round-trip.
- [ ] If you added a per-provider field, enabling it on one device and saving from a second device does not erase it.

## Debug

- Suspected loss of cloud-synced state: add a `console.log(disk)` and `console.log(this.settings)` at the top of `mergeBeforeSave`, reproduce on both devices, compare.
- Settings appear to revert: confirm there is no second save path that bypasses the merge. Search the codebase for `saveData(`.

## After This Task
- [ ] If you changed the persistence format (new top-level key, new migration), update `.cai/context/decisions.md`.
- [ ] Update `.cai/context/conventions.md` verify checklist if you introduced a new persistence rule.
