import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Notice,
  setIcon,
  TFile,
  MarkdownView,
  Component,
} from "obsidian";
import type LLMPlugin from "../../main";
import type { ChatSession } from "../../main";
import type { LLMProvider, ConversationMessage, StreamChunk } from "../types";
import { ACP_SUPPORTED_PROVIDERS, PROVIDER_DISPLAY_NAMES } from "../types";
import { fetchModelsForProvider } from "../utils/modelFetcher";
import { LLMExecutor } from "../executor/LLMExecutor";
import { AcpExecutor } from "../executor/AcpExecutor";
import { LocalLLMExecutor } from "../executor/LocalLLMExecutor";
import { VaultSearch } from "../utils/vaultSearch";
import { autoDetectProviders, applyDetectionResults } from "../utils/autoDetect";
import { setupCollapsible, collapseElement } from "../utils/collapsible";

export const CHAT_VIEW_TYPE = "llm-chat-view";

export class ChatView extends ItemView {
  plugin: LLMPlugin;
  private executor: LLMExecutor;
  private acpExecutor: AcpExecutor;
  private localExecutor: LocalLLMExecutor;
  private messages: ConversationMessage[] = [];
  private currentProvider: LLMProvider;
  private isLoading = false;
  private messagesContainer: HTMLElement | null = null;
  private pendingActionCallback: ((response: string) => Promise<void>) | null = null;
  private pendingDisplayLabel: string | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private progressContainer: HTMLElement | null = null;
  // Chat tabs
  private chatTabs: { id: string; name: string; messages: ConversationMessage[] }[] = [];
  private activeChatId: string = "";
  private tabBar: HTMLElement | null = null;
  private markdownComponents: Component[] = [];
  private toolHistory: string[] = [];
  private acpConnectionPromise: Promise<void> | null = null; // Track in-flight ACP connection
  // Thinking block state
  private thinkingBlockEl: HTMLElement | null = null;
  private thinkingContentEl: HTMLElement | null = null;
  private thinkingHeaderEl: HTMLElement | null = null;
  private thinkingLabelEl: HTMLElement | null = null;
  private thinkingState = { expanded: false };
  private thinkingStartTime: number | null = null;
  private thinkingTimerInterval: ReturnType<typeof setInterval> | null = null;
  // Thinking indicator debounce (400ms)
  private thinkingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private vaultSearch: VaultSearch;
  private quickActionsEl: HTMLElement | null = null;
  private contextChipEl: HTMLElement | null = null;
  private contextDismissed = true; // true = Whole Vault mode (default); false = active note as context
  private lastNoteContext: "code" | "tasks" | "questions" | "concept" | "prose" = "prose";
  // Track how often each action label was clicked (persisted in memory only, resets on reload)
  private actionClickCounts: Record<string, number> = {};
  // When a quick-action sets the prompt, the note content is already included — skip RAG
  private pendingSkipRag = false;
  // Pinned note context — file explicitly attached by user for this conversation
  private pinnedNote: TFile | null = null;
  private pinnedNoteBtn: HTMLButtonElement | null = null;
  // Per-session system prompt override (null = use settings value)
  private sessionSystemPromptFile: string | null = null;
  private systemPromptSelectEl: HTMLSelectElement | null = null;
  // Streaming render throttle — coalesce many onStream calls into one render per frame
  private pendingStreamingContent: string | null = null;
  private streamingRafHandle: number | null = null;
  private streamingMarkdownPossible = false;

  constructor(leaf: WorkspaceLeaf, plugin: LLMPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.executor = new LLMExecutor(plugin.settings);
    this.acpExecutor = new AcpExecutor(plugin.settings);
    this.localExecutor = new LocalLLMExecutor(plugin.settings);
    this.vaultSearch = new VaultSearch(plugin.app);
    this.currentProvider = plugin.settings.defaultProvider;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "LLM Chat";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen() {
    // Restore saved sessions
    this.loadSessions();

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("llm-chat-view");

    this.renderHeader(container as HTMLElement);
    this.renderMessages(container as HTMLElement);
    this.renderInput(container as HTMLElement);

    // Focus the input
    setTimeout(() => this.inputEl?.focus(), 50);

    // Index vault in background for RAG search
    VaultSearch.debugEnabled = this.plugin.settings.debugMode;
    this.vaultSearch.ensureIndex();

    // Eagerly connect to ACP if enabled for the current provider
    this.connectAcpIfEnabled();

    // Re-render dynamic quick-action buttons when the active note changes
    // Skip re-render while a request is in flight to avoid destroying click handlers
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.isLoading) {
          // When switching notes, go back to Whole Vault unless user explicitly chose note-context
          if (!this.pinnedNote) this.contextDismissed = true;
          this.updateDynamicQuickActions();
        }
      })
    );
  }

  async onClose() {
    // Save sessions before closing
    await this.persistSessions();
    this.executor.cancel();
    await this.acpExecutor.disconnect();
    this.vaultSearch.destroy();
    // Clean up markdown components
    this.markdownComponents.forEach((c) => c.unload());
    this.markdownComponents = [];
    // Reset status bar to default provider
    this.plugin.updateStatusBar();
  }

  private loadSessions() {
    const saved = this.plugin.getChatSessions();
    if (saved.length > 0) {
      this.chatTabs = saved.map((s) => ({
        id: s.id,
        name: s.name,
        messages: s.messages as ConversationMessage[],
      }));
      this.activeChatId = this.chatTabs[0].id;
      this.messages = this.chatTabs[0].messages;
    }
  }

  private async persistSessions() {
    // Sync current messages into active tab
    const current = this.chatTabs.find((t) => t.id === this.activeChatId);
    if (current) current.messages = this.messages;

    const sessions: ChatSession[] = this.chatTabs.map((t) => ({
      id: t.id,
      name: t.name,
      messages: t.messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        provider: m.provider,
      })),
    }));
    await this.plugin.saveChatSessions(sessions);
  }

  private providerSelectEl: HTMLSelectElement | null = null;
  private modelSelectEl: HTMLSelectElement | null = null;

  private renderHeader(container: HTMLElement) {
    const header = container.createDiv({ cls: "llm-chat-header" });

    // Chat tabs bar
    this.tabBar = header.createDiv({ cls: "llm-tab-bar" });

    // Initialize first chat if none exist
    if (this.chatTabs.length === 0) {
      this.createNewChat();
    }

    this.renderTabs();

    // Provider & model selector row
    const selectorRow = header.createDiv({ cls: "llm-selector-row" });
    const selectorPill = selectorRow.createDiv({ cls: "llm-selector-pill" });

    // Provider dropdown
    this.providerSelectEl = selectorPill.createEl("select", { cls: "llm-provider-select" });
    const allProviders: LLMProvider[] = ["claude", "opencode", "codex", "gemini", "local"];
    const enabledProviders = allProviders.filter((p) => this.plugin.settings.providers[p]?.enabled);

    // If current provider is not enabled, switch to first enabled one
    if (enabledProviders.length > 0 && !enabledProviders.includes(this.currentProvider)) {
      this.currentProvider = enabledProviders[0];
    }

    for (const p of enabledProviders) {
      const opt = this.providerSelectEl.createEl("option", {
        value: p,
        text: PROVIDER_DISPLAY_NAMES[p],
      });
      if (p === this.currentProvider) opt.selected = true;
    }
    this.providerSelectEl.addEventListener("change", () => {
      const newProvider = this.providerSelectEl!.value as LLMProvider;
      this.currentProvider = newProvider;
      this.plugin.updateStatusBar(newProvider);
      this.refreshModelSelect();
      this.connectAcpIfEnabled();
    });

    // Model dropdown
    this.modelSelectEl = selectorPill.createEl("select", { cls: "llm-model-select" });
    this.modelSelectEl.addEventListener("change", async () => {
      const newModel = this.modelSelectEl!.value;
      this.plugin.settings.providers[this.currentProvider].model = newModel || undefined;
      await this.plugin.saveSettings();
      this.plugin.updateStatusBar(this.currentProvider);
    });
    this.refreshModelSelect();

    // System prompt quick-switcher
    this.systemPromptSelectEl = selectorPill.createEl("select", {
      cls: "llm-system-prompt-select",
      attr: { "aria-label": "System prompt" },
    });
    this.refreshSystemPromptSelect();

    // Pin active note button
    this.pinnedNoteBtn = selectorRow.createEl("button", {
      cls: "llm-pin-note-btn clickable-icon",
      attr: { "aria-label": "Pin active note as context" },
    });
    setIcon(this.pinnedNoteBtn, "pin");
    this.pinnedNoteBtn.addEventListener("click", () => this.togglePinnedNote());

    // Export conversation button
    const exportBtn = selectorRow.createEl("button", {
      cls: "llm-export-btn clickable-icon",
      attr: { "aria-label": "Save conversation as note" },
    });
    setIcon(exportBtn, "download");
    exportBtn.addEventListener("click", () => this.exportConversation());

    // Update status bar to show initial provider
    this.plugin.updateStatusBar(this.currentProvider);
  }

  /**
   * Refresh the model dropdown options for the current provider
   */
  private async refreshModelSelect() {
    if (!this.modelSelectEl) return;
    this.modelSelectEl.empty();

    const config = this.plugin.settings.providers[this.currentProvider];
    const currentModel = config?.model || "";

    // Add loading placeholder
    this.modelSelectEl.createEl("option", { value: "", text: "Loading models..." });

    try {
      const models = await fetchModelsForProvider(this.currentProvider, config);
      this.modelSelectEl.empty();

      // If the stored model is not in the available list, reset it.
      // Otherwise the dropdown shows the first option visually but the
      // background config still points at an invalid model.
      const isValid = !currentModel || models.some((m) => m.value === currentModel);
      if (!isValid) {
        const fallback = models.find((m) => m.value !== "")?.value || "";
        if (config) {
          config.model = fallback || undefined;
          await this.plugin.saveSettings();
        }
        new Notice(`Model "${currentModel}" not available — switched to "${fallback || "default"}"`);
      }

      const effectiveModel = isValid ? currentModel : (config?.model || "");
      for (const m of models) {
        const opt = this.modelSelectEl.createEl("option", {
          value: m.value,
          text: m.label,
        });
        if (m.value === effectiveModel) opt.selected = true;
      }
    } catch {
      this.modelSelectEl.empty();
      this.modelSelectEl.createEl("option", { value: "", text: "Default" });
    }
  }

  /**
   * Export the entire conversation as a markdown note
   */
  private async exportConversation() {
    if (this.messages.length === 0) {
      new Notice("No messages to export");
      return;
    }

    const tab = this.chatTabs.find((t) => t.id === this.activeChatId);
    const chatName = tab?.name || "Chat";
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const lines: string[] = [];
    lines.push(`# ${chatName}`);
    lines.push(`*Exported ${now.toLocaleString()}*\n`);

    for (const msg of this.messages) {
      const role = msg.role === "user" ? "You" : PROVIDER_DISPLAY_NAMES[msg.provider];
      const time = new Date(msg.timestamp).toLocaleTimeString();
      lines.push(`## ${role} — ${time}\n`);
      lines.push(msg.content);
      lines.push("");
    }

    const content = lines.join("\n");
    let fileName = `${chatName} ${dateStr}.md`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(fileName)) {
      fileName = `${chatName} ${dateStr} ${counter}.md`;
      counter++;
    }

    try {
      const file = await this.app.vault.create(fileName, content);
      new Notice(`Conversation saved: ${file.path}`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (error) {
      new Notice(`Failed to export: ${error}`);
    }
  }

  /**
   * Toggle pinned note: pins the active note, or unpins if already pinned.
   */
  private togglePinnedNote() {
    const activeView = this.getEditorView();
    const activeFile = activeView?.file ?? null;

    if (this.pinnedNote && activeFile && this.pinnedNote.path === activeFile.path) {
      // Unpin
      this.pinnedNote = null;
      this.updatePinnedNoteUI();
      new Notice("Note unpinned from chat");
    } else if (activeFile) {
      // Pin new note
      this.pinnedNote = activeFile;
      this.updatePinnedNoteUI();
      new Notice(`Pinned: ${activeFile.basename}`);
    } else {
      new Notice("No active note to pin");
    }
  }

  private updatePinnedNoteUI() {
    if (!this.pinnedNoteBtn) return;
    if (this.pinnedNote) {
      this.pinnedNoteBtn.addClass("llm-pin-active");
      this.pinnedNoteBtn.setAttribute("aria-label", `Unpin: ${this.pinnedNote.basename}`);
    } else {
      this.pinnedNoteBtn.removeClass("llm-pin-active");
      this.pinnedNoteBtn.setAttribute("aria-label", "Pin active note as context");
    }
  }

  /**
   * Populate the system prompt dropdown with available .md files from the vault root
   * plus the "Auto" (default) option and the currently configured file.
   */
  private async refreshSystemPromptSelect() {
    if (!this.systemPromptSelectEl) return;
    this.systemPromptSelectEl.empty();

    // "Auto" = use default smart prompt
    this.systemPromptSelectEl.createEl("option", { value: "", text: "System: Auto" });

    // Find markdown files that look like system prompts (in vault root or a /prompts/ folder)
    const allFiles = this.app.vault.getMarkdownFiles();
    const promptFiles = allFiles.filter((f) => {
      const lower = f.path.toLowerCase();
      return lower.startsWith("prompts/") || lower.startsWith("system/") || lower.includes("system-prompt");
    });

    // Also include the currently configured file if not already in list
    const configuredPath = this.plugin.settings.systemPromptFile;
    if (configuredPath && !promptFiles.find((f) => f.path === configuredPath)) {
      const configFile = this.app.vault.getAbstractFileByPath(configuredPath);
      if (configFile instanceof TFile) promptFiles.unshift(configFile);
    }

    for (const f of promptFiles) {
      const opt = this.systemPromptSelectEl.createEl("option", {
        value: f.path,
        text: f.basename,
      });
      const active = this.sessionSystemPromptFile ?? configuredPath ?? "";
      if (f.path === active) opt.selected = true;
    }

    // Use onchange (property) instead of addEventListener to avoid accumulating
    // listeners on each refresh call
    this.systemPromptSelectEl.onchange = () => {
      this.sessionSystemPromptFile = this.systemPromptSelectEl!.value || null;
    };
  }

  /**
   * Drop all per-conversation server-side session state.
   * Must be called on tab switch / new chat / clear chat — otherwise
   * `--resume <old-session>` or the persistent ACP session would bleed
   * previous-conversation memory into the new one (and the history-skip
   * optimization would hide this from the user).
   */
  private resetTransportSessions(): void {
    this.executor.clearSession();
    if (this.acpExecutor.isConnected()) {
      const cwd = this.getVaultPath() ?? "";
      // Reuse the existing agent process; only start a fresh ACP session.
      // Full disconnect would force the next send to pay reconnect cost.
      void this.acpExecutor.resetSession(cwd);
    }
  }

  private createNewChat(): string {
    const id = `chat-${Date.now()}`;
    const num = this.chatTabs.length + 1;
    this.chatTabs.push({ id, name: `Chat ${num}`, messages: [] });
    this.activeChatId = id;
    this.messages = this.chatTabs[this.chatTabs.length - 1].messages;
    this.resetTransportSessions();
    return id;
  }

  private switchChat(id: string) {
    // Save current messages
    const current = this.chatTabs.find((t) => t.id === this.activeChatId);
    if (current) current.messages = this.messages;

    // Switch
    const target = this.chatTabs.find((t) => t.id === id);
    if (!target) return;
    this.activeChatId = id;
    this.messages = target.messages;
    this.resetTransportSessions();
    this.renderTabs();
    this.renderMessagesContent(true);
  }

  private renderTabs() {
    if (!this.tabBar) return;
    this.tabBar.empty();

    for (const tab of this.chatTabs) {
      const tabEl = this.tabBar.createDiv({
        cls: `llm-tab ${tab.id === this.activeChatId ? "llm-tab-active" : ""}`,
      });

      const labelEl = tabEl.createSpan({ cls: "llm-tab-label", text: tab.name });

      // Double-click to rename
      labelEl.addEventListener("dblclick", () => {
        const input = createEl("input", {
          cls: "llm-tab-rename",
          value: tab.name,
        });
        labelEl.replaceWith(input);
        input.focus();
        input.select();
        const finish = () => {
          tab.name = input.value.trim() || tab.name;
          this.renderTabs();
          this.persistSessions();
        };
        input.addEventListener("blur", finish);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") finish();
          if (e.key === "Escape") this.renderTabs();
        });
      });

      // Click to switch
      tabEl.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        this.switchChat(tab.id);
      });

      // Close button (only if more than 1 tab)
      if (this.chatTabs.length > 1) {
        const closeBtn = tabEl.createEl("button", {
          cls: "llm-tab-close",
          attr: { "aria-label": "Close chat" },
        });
        setIcon(closeBtn, "x");
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.chatTabs = this.chatTabs.filter((t) => t.id !== tab.id);
          if (this.activeChatId === tab.id) {
            this.switchChat(this.chatTabs[0].id);
          } else {
            this.renderTabs();
          }
          this.persistSessions();
        });
      }
    }

    // New chat button
    const newBtn = this.tabBar.createEl("button", {
      cls: "llm-tab-new",
      attr: { "aria-label": "New chat" },
    });
    setIcon(newBtn, "plus");
    newBtn.addEventListener("click", () => {
      const current = this.chatTabs.find((t) => t.id === this.activeChatId);
      if (current) current.messages = this.messages;
      this.createNewChat();
      this.renderTabs();
      this.renderMessagesContent(true);
      this.persistSessions();
      this.inputEl?.focus();
    });

    // Clear current chat button
    const clearBtn = this.tabBar.createEl("button", {
      cls: "llm-tab-clear",
      attr: { "aria-label": "Clear chat" },
    });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => {
      if (this.messages.length === 0) return;
      const backup = [...this.messages];
      this.messages = [];
      this.resetTransportSessions();
      this.renderMessagesContent(true);
      this.persistSessions();
      // Undo via a link rendered inside the notice element
      const notice = new Notice("Chat cleared.", 5000);
      // Append undo link into the notice element
      const noticeEl = (notice as any).noticeEl as HTMLElement | undefined;
      if (noticeEl) {
        noticeEl.createSpan({ text: " " });
        const undoLink = noticeEl.createEl("a", { text: "Undo", href: "#" });
        undoLink.style.cursor = "pointer";
        undoLink.addEventListener("click", (e) => {
          e.preventDefault();
          this.messages = backup;
          this.renderMessagesContent(true);
          this.persistSessions();
          notice.hide();
        }, { once: true });
      }
    });
  }

  private renderMessages(container: HTMLElement) {
    this.messagesContainer = container.createDiv({ cls: "llm-chat-messages" });
    this.renderMessagesContent();
  }

  /** Number of messages already rendered in the DOM */
  private renderedCount = 0;

  /**
   * Render messages — incrementally appends only new messages
   * instead of rebuilding the entire DOM on every call.
   * Pass force=true (or call after tab switch) for full rebuild.
   */
  private async renderMessagesContent(force = false) {
    if (!this.messagesContainer) return;

    // Full rebuild needed when switching tabs or messages were removed
    if (force || this.renderedCount > this.messages.length) {
      this.markdownComponents.forEach((c) => c.unload());
      this.markdownComponents = [];
      this.messagesContainer.empty();
      this.renderedCount = 0;
    }

    // Remove stale follow-up chips on rebuild
    if (force) {
      this.messagesContainer.querySelector(".llm-followup-chips")?.remove();
    }

    // Empty state — show setup guidance if no providers enabled
    if (this.messages.length === 0) {
      const allProviders: LLMProvider[] = ["claude", "opencode", "codex", "gemini", "local"];
      const enabledProviders = allProviders.filter((p) => this.plugin.settings.providers[p]?.enabled);

      if (enabledProviders.length === 0) {
        this.renderSetupBanner();
      } else {
        const emptyState = this.messagesContainer.createDiv({ cls: "llm-empty-state" });
        emptyState.createEl("p", { text: "Start a conversation with AI." });
        emptyState.createEl("p", {
          text: "Type a message below, or select text in a note and use the command palette.",
          cls: "llm-empty-hint",
        });
      }
      return;
    }

    // Remove empty state if present
    this.messagesContainer.querySelector(".llm-empty-state")?.remove();

    // Only render messages we haven't rendered yet
    const startIdx = this.renderedCount;
    for (let i = startIdx; i < this.messages.length; i++) {
      await this.renderSingleMessage(this.messages[i]);
    }
    this.renderedCount = this.messages.length;

    // Scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  /**
   * Render a single message and append it to the messages container.
   */
  /**
   * Render the setup banner when no providers are enabled.
   * Shows a welcome message with a scan button that auto-detects providers.
   */
  private renderSetupBanner() {
    if (!this.messagesContainer) return;

    const banner = this.messagesContainer.createDiv({ cls: "llm-setup-banner" });

    banner.createEl("h3", { text: "Welcome to AI Chat" });
    banner.createEl("p", {
      text: "No AI providers are configured yet. Let's find what's available on your system.",
    });

    const actions = banner.createDiv({ cls: "llm-setup-actions" });

    // Scan button
    const scanBtn = actions.createEl("button", {
      text: "Scan for providers",
      cls: "llm-setup-scan-btn",
    });
    setIcon(scanBtn.createSpan({ cls: "llm-setup-scan-icon" }), "search");

    const statusEl = banner.createDiv({ cls: "llm-setup-status" });

    scanBtn.addEventListener("click", async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = "Scanning...";
      statusEl.empty();

      try {
        const result = await autoDetectProviders();

        if (result.detected.length > 0) {
          applyDetectionResults(this.plugin.settings, result);
          await this.plugin.saveSettings();

          const names = result.detected.map((d) => d.name).join(", ");
          statusEl.empty();
          statusEl.createEl("p", { text: `Found: ${names}`, cls: "llm-setup-success" });
          statusEl.createEl("p", { text: "Reloading...", cls: "llm-setup-hint" });

          // Re-render the full view with the new providers
          setTimeout(async () => {
            const allProviders: LLMProvider[] = ["claude", "opencode", "codex", "gemini", "local"];
            const enabled = allProviders.filter((p) => this.plugin.settings.providers[p]?.enabled);
            if (enabled.length > 0) {
              this.currentProvider = enabled[0];
            }
            await this.onOpen();
          }, 500);
        } else {
          statusEl.empty();
          statusEl.createEl("p", {
            text: "No providers detected.",
            cls: "llm-setup-hint",
          });
          this.renderManualSetupHints(statusEl);
        }
      } catch {
        statusEl.empty();
        statusEl.createEl("p", { text: "Scan failed. Try again or configure manually.", cls: "llm-setup-hint" });
      }

      scanBtn.disabled = false;
      scanBtn.textContent = "Scan again";
    });

    // Settings link
    const settingsBtn = actions.createEl("button", {
      text: "Open settings",
      cls: "llm-setup-settings-btn",
    });
    settingsBtn.addEventListener("click", () => {
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.open();
      (this.app as unknown as { setting: { openTabById: (id: string) => void } }).setting.openTabById("obsidian-llm");
    });

    // Quick hints
    this.renderManualSetupHints(banner);
  }

  /**
   * Render manual setup hints for common providers.
   */
  private renderManualSetupHints(container: HTMLElement) {
    const hints = container.createDiv({ cls: "llm-setup-hints" });
    hints.createEl("p", { text: "Quick setup options:", cls: "llm-setup-hints-title" });

    const list = hints.createEl("ul");
    list.createEl("li").innerHTML = "<strong>Claude</strong> &mdash; <code>npm install -g @anthropic-ai/claude-code</code>";
    list.createEl("li").innerHTML = "<strong>Gemini</strong> &mdash; <code>npm install -g @anthropic-ai/gemini-cli</code> (or via Google)";
    list.createEl("li").innerHTML = "<strong>Codex</strong> &mdash; <code>npm install -g @openai/codex</code>";
    list.createEl("li").innerHTML = "<strong>Ollama</strong> &mdash; <a href='https://ollama.com'>ollama.com</a> (local, free)";
  }

  private async renderSingleMessage(msg: ConversationMessage) {
    if (!this.messagesContainer) return;

    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile?.path ?? "";

    const msgEl = this.messagesContainer.createDiv({
      cls: `llm-message llm-message-${msg.role}`,
      attr: { "data-msg-id": String(msg.timestamp) },
    });

    // Avatar
    const avatarEl = msgEl.createDiv({ cls: "llm-message-avatar" });
    if (msg.role === "user") {
      avatarEl.setText("U");
    } else {
      setIcon(avatarEl, "bot");
    }

    // Body wrapper (header + bubble + badge)
    const bodyEl = msgEl.createDiv({ cls: "llm-message-body" });

    const headerEl = bodyEl.createDiv({ cls: "llm-message-header" });
    headerEl.createSpan({
      text: msg.role === "user" ? "You" : PROVIDER_DISPLAY_NAMES[msg.provider],
      cls: "llm-message-role",
    });
    headerEl.createSpan({
      text: new Date(msg.timestamp).toLocaleTimeString(),
      cls: "llm-message-time",
    });

    const actionsEl = headerEl.createDiv({ cls: "llm-message-actions" });

    const copyBtn = actionsEl.createEl("button", {
      cls: "llm-action-btn",
      attr: { "aria-label": "Copy to clipboard" },
    });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(msg.content);
      new Notice("Copied to clipboard");
    });

    if (msg.role === "assistant") {
      const createNoteBtn = actionsEl.createEl("button", {
        cls: "llm-action-btn",
        attr: { "aria-label": "Create note from response" },
      });
      setIcon(createNoteBtn, "file-plus");
      createNoteBtn.addEventListener("click", () => this.createNoteFromMessage(msg));
    }

    // Bubble
    const bubbleEl = bodyEl.createDiv({ cls: "llm-message-bubble" });
    const contentEl = bubbleEl.createDiv({ cls: "llm-message-content" });

    if (msg.role === "assistant") {
      const component = new Component();
      component.load();
      this.markdownComponents.push(component);
      await MarkdownRenderer.render(
        this.app,
        msg.content,
        contentEl,
        sourcePath,
        component
      );

      contentEl.querySelectorAll("a.internal-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const href = (link as HTMLElement).dataset.href;
          if (href) {
            this.app.workspace.openLinkText(href, sourcePath);
          }
        });
      });

      this.attachCheckboxHandlers(contentEl, msg);
      this.attachButtonHandlers(contentEl);

      // Add copy buttons to code blocks
      contentEl.querySelectorAll("pre > code").forEach((codeEl) => {
        const pre = codeEl.parentElement!;
        pre.style.position = "relative";
        const copyCodeBtn = pre.createEl("button", {
          cls: "llm-code-copy-btn",
          attr: { "aria-label": "Copy code" },
        });
        setIcon(copyCodeBtn, "copy");
        copyCodeBtn.addEventListener("click", () => {
          navigator.clipboard.writeText((codeEl as HTMLElement).innerText);
          setIcon(copyCodeBtn, "check");
          copyCodeBtn.addClass("llm-copied");
          setTimeout(() => {
            setIcon(copyCodeBtn, "copy");
            copyCodeBtn.removeClass("llm-copied");
          }, 1500);
        });
      });

      // Token + duration badge
      if (msg.durationMs || msg.tokensUsed) {
        const badgeEl = bodyEl.createDiv({ cls: "llm-message-badge" });
        if (msg.tokensUsed) {
          const total = msg.tokensUsed.input + msg.tokensUsed.output;
          badgeEl.createSpan({ text: `↗ ${total.toLocaleString()} tokens` });
        }
        if (msg.durationMs) {
          badgeEl.createSpan({ text: `${(msg.durationMs / 1000).toFixed(1)}s` });
        }
      }
    } else {
      if (msg.displayLabel) {
        // Collapsed pill with expandable full prompt
        const pill = contentEl.createDiv({ cls: "llm-action-pill" });
        // Split "Action · Note title" into two lines
        const sepIdx = msg.displayLabel.indexOf(" · ");
        if (sepIdx > -1) {
          pill.createSpan({ cls: "llm-action-pill-label", text: msg.displayLabel.slice(0, sepIdx) });
          pill.createSpan({ cls: "llm-action-pill-note", text: msg.displayLabel.slice(sepIdx + 3) });
        } else {
          pill.createSpan({ cls: "llm-action-pill-label", text: msg.displayLabel });
        }
        const toggle = pill.createSpan({ cls: "llm-action-pill-toggle", text: "›" });
        const fullText = contentEl.createDiv({ cls: "llm-action-pill-full" });
        fullText.setText(msg.content);
        fullText.style.display = "none";
        pill.addEventListener("click", () => {
          const expanded = fullText.style.display !== "none";
          fullText.style.display = expanded ? "none" : "block";
          toggle.textContent = expanded ? "›" : "‹";
        });
      } else {
        contentEl.setText(msg.content);
      }
    }

    // Scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private renderInput(container: HTMLElement) {
    const inputContainer = container.createDiv({ cls: "llm-chat-input-container" });

    // Context chip — shows active note name and detected context type
    this.contextChipEl = inputContainer.createDiv({ cls: "llm-context-chip" });
    this.updateContextChip();

    // Quick action buttons
    this.renderQuickActions(inputContainer);

    // New wrapper for the input and send button
    const inputWrapper = inputContainer.createDiv({ cls: "llm-input-wrapper" });

    this.inputEl = inputWrapper.createEl("textarea", {
      cls: "llm-chat-input",
      attr: {
        placeholder: "Ask anything... (Enter to send)",
        rows: "1",
      },
    });

    // Char counter — shown once input exceeds 200 chars
    const charCounterEl = inputWrapper.createSpan({ cls: "llm-char-counter" });
    charCounterEl.style.display = "none";

    // Auto-grow textarea as user types
    const autoGrow = () => {
      if (!this.inputEl) return;
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + "px";

      // Update char counter
      const len = this.inputEl.value.length;
      if (len >= 200) {
        charCounterEl.style.display = "block";
        charCounterEl.setText(len >= 1000 ? `${(len / 1000).toFixed(1)}k` : `${len}`);
        charCounterEl.toggleClass("llm-char-counter-warn", len >= 4000);
      } else {
        charCounterEl.style.display = "none";
      }
    };
    this.inputEl.addEventListener("input", autoGrow);

    // [[Note]] suggest dropdown
    const suggestContainer = inputContainer.createDiv({ cls: "llm-note-suggest" });
    suggestContainer.style.display = "none";
    let suggestItems: TFile[] = [];
    let suggestIdx = -1;
    let suggestStart = -1; // cursor position where [[ started

    const closeSuggest = () => {
      suggestContainer.style.display = "none";
      suggestContainer.empty();
      suggestItems = [];
      suggestIdx = -1;
      suggestStart = -1;
    };

    const updateSuggest = () => {
      if (!this.inputEl) return;
      const val = this.inputEl.value;
      const cursor = this.inputEl.selectionStart;

      // Find the last [[ before cursor that hasn't been closed with ]]
      const before = val.slice(0, cursor);
      const openIdx = before.lastIndexOf("[[");
      if (openIdx < 0 || before.indexOf("]]", openIdx) >= 0) {
        closeSuggest();
        return;
      }

      suggestStart = openIdx;
      const query = before.slice(openIdx + 2).toLowerCase();
      const allFiles = this.app.vault.getMarkdownFiles();

      // Filter and sort by relevance
      suggestItems = allFiles
        .filter((f) => f.basename.toLowerCase().includes(query) || f.path.toLowerCase().includes(query))
        .sort((a, b) => {
          // Prioritize basename matches
          const aBase = a.basename.toLowerCase().startsWith(query) ? 0 : 1;
          const bBase = b.basename.toLowerCase().startsWith(query) ? 0 : 1;
          return aBase - bBase || a.basename.localeCompare(b.basename);
        })
        .slice(0, 8);

      if (suggestItems.length === 0) {
        closeSuggest();
        return;
      }

      suggestContainer.empty();
      suggestContainer.style.display = "block";
      suggestIdx = 0;

      suggestItems.forEach((file, i) => {
        const item = suggestContainer.createDiv({
          cls: `llm-suggest-item ${i === suggestIdx ? "llm-suggest-active" : ""}`,
          text: file.basename,
        });
        if (file.parent && file.parent.path !== "/") {
          item.createSpan({ cls: "llm-suggest-path", text: ` — ${file.parent.path}` });
        }
        item.addEventListener("mousedown", (e) => {
          e.preventDefault(); // prevent textarea blur
          acceptSuggest(i);
        });
      });
    };

    const renderSuggestHighlight = () => {
      suggestContainer.querySelectorAll(".llm-suggest-item").forEach((el, i) => {
        el.toggleClass("llm-suggest-active", i === suggestIdx);
      });
    };

    const acceptSuggest = (idx: number) => {
      if (!this.inputEl || idx < 0 || idx >= suggestItems.length) return;
      const file = suggestItems[idx];
      const val = this.inputEl.value;
      const cursor = this.inputEl.selectionStart;
      // Replace [[query with [[filename]]
      const before = val.slice(0, suggestStart);
      const after = val.slice(cursor);
      const insert = `[[${file.basename}]]`;
      this.inputEl.value = before + insert + after;
      const newCursor = before.length + insert.length;
      this.inputEl.setSelectionRange(newCursor, newCursor);
      this.inputEl.focus();
      closeSuggest();
      autoGrow();
    };

    this.inputEl.addEventListener("input", updateSuggest);
    this.inputEl.addEventListener("blur", () => {
      // Delay to allow mousedown on suggest items
      setTimeout(closeSuggest, 200);
    });

    // Enter to send, Shift+Enter for newline, arrows for suggest navigation
    this.inputEl.addEventListener("keydown", (e) => {
      // Handle suggest navigation
      if (suggestContainer.style.display !== "none" && suggestItems.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          suggestIdx = (suggestIdx + 1) % suggestItems.length;
          renderSuggestHighlight();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          suggestIdx = (suggestIdx - 1 + suggestItems.length) % suggestItems.length;
          renderSuggestHighlight();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          acceptSuggest(suggestIdx);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeSuggest();
          return;
        }
      }

      if (e.key === "Escape" && this.isLoading) {
        e.preventDefault();
        this.cancelRequest();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this.sendMessage();
      }
    }, true);

    this.sendBtn = inputWrapper.createEl("button", {
      cls: "llm-chat-send",
      attr: { "aria-label": "Send message" },
    });
    setIcon(this.sendBtn, "send");
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    this.cancelBtn = inputWrapper.createEl("button", {
      cls: "llm-chat-cancel",
      attr: { "aria-label": "Cancel" },
    });
    setIcon(this.cancelBtn, "square");
    this.cancelBtn.style.display = "none";
    this.cancelBtn.addEventListener("click", () => this.cancelRequest());
  }

  /**
   * Detect what kind of content a note contains, to pick context-aware actions.
   */
  private detectNoteContext(content: string): "code" | "tasks" | "questions" | "concept" | "prose" {
    const codeBlockCount = (content.match(/```/g) ?? []).length / 2;
    if (codeBlockCount >= 1) return "code";

    const taskCount = (content.match(/^- \[[ x]\]/gm) ?? []).length;
    if (taskCount >= 3) return "tasks";

    const questionCount = (content.match(/\?/g) ?? []).length;
    if (questionCount >= 3) return "questions";

    // Concept-heavy: many headings or inline code or bold terms
    const headingCount = (content.match(/^#{1,6} /gm) ?? []).length;
    const boldCount = (content.match(/\*\*/g) ?? []).length / 2;
    if (headingCount >= 3 || boldCount >= 5) return "concept";

    return "prose";
  }

  /**
   * Returns the 3 dynamic action definitions based on note context.
   */
  private getDynamicActions(context: "code" | "tasks" | "questions" | "concept" | "prose"): {
    label: string;
    icon: string;
    prompt: (title: string, content: string) => string;
    onResponse?: (response: string, title: string, file: TFile) => Promise<void>;
  }[] {
    switch (context) {
      case "code":
        return [
          {
            label: "Explain Code",
            icon: "code",
            prompt: (title, content) =>
              `Explain what the code in this note does. Describe the purpose, logic, and any noteworthy patterns. Be clear and concise.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Review",
            icon: "shield-check",
            prompt: (title, content) =>
              `Review the code in this note. Point out bugs, edge cases, security issues, and improvement opportunities. Be specific.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Add Tests",
            icon: "flask-conical",
            prompt: (title, content) =>
              `Write test cases for the code in this note. Cover happy paths, edge cases, and error conditions. Output only the test code.\n\nNote: ${title}\n\n${content}`,
          },
        ];
      case "tasks":
        return [
          {
            label: "Prioritize",
            icon: "arrow-up-down",
            prompt: (title, content) =>
              `Analyze this task list and suggest a priority order. Group by urgency/importance, flag blockers, and recommend what to tackle first and why.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Next Steps",
            icon: "arrow-right-circle",
            prompt: (title, content) =>
              `Based on this task list, what concrete next steps should be taken? Identify dependencies, suggest quick wins, and flag anything unclear.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Find Gaps",
            icon: "search-x",
            prompt: (title, content) =>
              `What tasks or steps are missing from this list? What has been overlooked or is implied but not written?\n\nNote: ${title}\n\n${content}`,
          },
        ];
      case "questions":
        return [
          {
            label: "Answer",
            icon: "message-circle",
            prompt: (title, content) =>
              `Answer the questions in this note as clearly and precisely as possible. Address each question individually.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Research Plan",
            icon: "map",
            prompt: (title, content) =>
              `Create a research plan to find answers to the questions in this note. Suggest sources, methods, and key search terms.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Find Gaps",
            icon: "search-x",
            prompt: (title, content) =>
              `What important questions are missing from this note? What should also be asked but isn't?\n\nNote: ${title}\n\n${content}`,
          },
        ];
      case "concept":
        return [
          {
            label: "Feynman",
            icon: "graduation-cap",
            prompt: (title, content) =>
              `Explain the core idea of the following note using the Feynman technique: as if explaining to a curious 12-year-old. Use simple words, concrete analogies, and no jargon. If there are gaps or unclear parts in the original, point them out.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Key Points",
            icon: "list-checks",
            prompt: (title, content) =>
              `Extract the most important key points from this note as a concise bullet list. Max 7 points. Output only the bullet list.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Find Gaps",
            icon: "search-x",
            prompt: (title, content) =>
              `Analyze this note critically. What is missing, unclear, or contradictory? What questions does it raise but not answer? Be specific and direct.\n\nNote: ${title}\n\n${content}`,
          },
        ];
      default: // prose
        return [
          {
            label: "Key Points",
            icon: "list-checks",
            prompt: (title, content) =>
              `Extract the most important key points from this note as a concise bullet list. Max 7 points. Output only the bullet list.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Feynman",
            icon: "graduation-cap",
            prompt: (title, content) =>
              `Explain the core idea of the following note using the Feynman technique: as if explaining to a curious 12-year-old. Use simple words, concrete analogies, and no jargon.\n\nNote: ${title}\n\n${content}`,
          },
          {
            label: "Find Gaps",
            icon: "search-x",
            prompt: (title, content) =>
              `Analyze this note critically. What is missing, unclear, or contradictory? What questions does it raise but not answer? Be specific and direct.\n\nNote: ${title}\n\n${content}`,
          },
        ];
    }
  }

  /**
   * Quick action buttons above the input — 2 static + 3 context-aware buttons.
   */
  private renderQuickActions(container: HTMLElement) {
    this.quickActionsEl = container.createDiv({ cls: "llm-quick-actions" });
    this.renderQuickActionButtons();
  }

  /**
   * (Re-)populate quick action buttons based on the active note context.
   */
  private renderQuickActionButtons() {
    if (!this.quickActionsEl) return;
    this.quickActionsEl.empty();

    // Quick actions operate on the active note — hide them in Whole Vault mode
    if (this.contextDismissed) {
      this.quickActionsEl.style.display = "none";
      return;
    }
    this.quickActionsEl.style.display = "";

    const activeView = this.getEditorView();
    const noteContent = activeView?.editor.getValue() ?? null;
    const context = noteContent ? this.detectNoteContext(noteContent) : "prose";

    const staticActions: {
      label: string;
      icon: string;
      prompt: (title: string, content: string) => string;
      onResponse?: (response: string, title: string, file: TFile) => Promise<void>;
    }[] = [
      {
        label: "Summarize",
        icon: "file-text",
        prompt: (title, content) =>
          `Summarize this note concisely. Output only the summary as clean Markdown — no intro, no "here is a summary".\n\nNote: ${title}\n\n${content}`,
        onResponse: async (response, title) => {
          const summaryPath = `${title} — Summary.md`;
          const existing = this.app.vault.getAbstractFileByPath(summaryPath);
          if (existing instanceof TFile) {
            await this.app.vault.modify(existing, response);
          } else {
            await this.app.vault.create(summaryPath, response);
          }
          new Notice(`Summary saved: ${summaryPath}`);
        },
      },
      {
        label: "Rewrite",
        icon: "pen-line",
        prompt: (title, content) =>
          `Rewrite the following note more clearly and professionally. Keep the meaning and structure, improve wording and flow. Output only the rewritten Markdown — no intro text.\n\nNote: ${title}\n\n${content}`,
        onResponse: async (response, _title, file) => {
          const activeView = this.getEditorView();
          if (activeView?.file?.path === file.path) {
            activeView.editor.setValue(response);
          } else {
            await this.app.vault.modify(file, response);
          }
          new Notice("Note rewritten");
        },
      },
    ];

    // Sort dynamic actions: most-clicked first (within same context)
    const dynamicActions = this.getDynamicActions(context).sort((a, b) => {
      const aCount = this.actionClickCounts[`${context}:${a.label}`] ?? 0;
      const bCount = this.actionClickCounts[`${context}:${b.label}`] ?? 0;
      return bCount - aCount;
    });

    const allActions = [...staticActions, ...dynamicActions];

    // Animate buttons if context changed
    const contextChanged = context !== this.lastNoteContext;
    if (contextChanged) {
      this.lastNoteContext = context;
      this.quickActionsEl.addClass("llm-quick-actions-fade");
      setTimeout(() => this.quickActionsEl?.removeClass("llm-quick-actions-fade"), 300);
    }

    for (const action of allActions) {
      const btn = this.quickActionsEl.createEl("button", {
        cls: "llm-quick-action-btn",
        attr: { "aria-label": action.label },
      });
      setIcon(btn, action.icon);
      btn.createSpan({ text: action.label });

      btn.addEventListener("click", () => {
        if (this.isLoading || !this.inputEl) return;
        const activeView = this.getEditorView();

        // Selection-aware: use selected text if available, else whole note
        const selection = activeView?.editor.getSelection() ?? "";
        const noteContent = (selection.trim() || activeView?.editor.getValue()) ?? null;
        const noteTitle = activeView?.file?.basename ?? null;
        const noteFile = activeView?.file ?? null;

        if (!noteContent || !noteTitle || !noteFile) {
          new Notice("Open a note first");
          return;
        }

        // Apply visual feedback immediately so browser paints before any JS work
        const spanEl = btn.querySelector("span");
        const originalLabel = spanEl?.textContent ?? action.label;
        btn.addClass("llm-quick-action-active");
        btn.setAttribute("disabled", "true");
        if (spanEl) spanEl.textContent = originalLabel + "…";

        const resetBtn = () => {
          btn.removeClass("llm-quick-action-active");
          btn.removeAttribute("disabled");
          if (spanEl) spanEl.textContent = originalLabel;
        };

        // Track click for future ordering
        const countKey = `${context}:${action.label}`;
        this.actionClickCounts[countKey] = (this.actionClickCounts[countKey] ?? 0) + 1;

        const isSelection = selection.trim().length > 0;
        const contextNote = isSelection ? `Selected text from "${noteTitle}"` : `Note: ${noteTitle}`;
        const prompt = action.prompt(contextNote, noteContent);

        if (action.onResponse && !isSelection) {
          this.pendingActionCallback = async (response: string) => {
            await action.onResponse!(response, noteTitle, noteFile);
          };
        } else {
          this.pendingActionCallback = null;
        }

        // Short display label instead of full prompt in chat
        this.pendingDisplayLabel = `${action.label} · ${noteTitle}`;
        // Note content is already in the prompt — skip vault RAG to avoid index-wait delay
        this.pendingSkipRag = true;

        this.inputEl.value = prompt;
        this.sendMessage().finally(() => resetBtn());
      });
    }
  }

  /**
   * Called on active-leaf-change to refresh the dynamic buttons and context chip.
   */
  private updateDynamicQuickActions() {
    this.updateContextChip();
    this.renderQuickActionButtons();
  }

  /**
   * Update the context chip showing the active note name and detected context.
   */
  private updateContextChip() {
    if (!this.contextChipEl) return;
    this.contextChipEl.empty();

    const activeView = this.getEditorView();

    // No active note at all — hide chip
    if (!activeView?.file) {
      this.contextChipEl.style.display = "none";
      return;
    }

    this.contextChipEl.style.display = "flex";

    // User dismissed the note context → show "Whole Vault" pill
    if (this.contextDismissed) {
      const iconEl = this.contextChipEl.createSpan({ cls: "llm-context-chip-icon" });
      setIcon(iconEl, "library");
      this.contextChipEl.createSpan({
        cls: "llm-context-chip-note llm-context-chip-vault",
        text: "Whole Vault",
      });
      // Restore button
      const restoreBtn = this.contextChipEl.createEl("button", {
        cls: "llm-context-chip-restore",
        attr: { "aria-label": "Use active note as context" },
      });
      setIcon(restoreBtn, "rotate-ccw");
      restoreBtn.addEventListener("click", () => {
        this.contextDismissed = false;
        this.updateContextChip();
        this.renderQuickActionButtons();
      });
      return;
    }

    const content = activeView.editor.getValue();
    const context = this.detectNoteContext(content);

    const contextIcons: Record<string, string> = {
      code: "code",
      tasks: "check-square",
      questions: "help-circle",
      concept: "book-open",
      prose: "file-text",
    };
    const contextLabels: Record<string, string> = {
      code: "Code",
      tasks: "Tasks",
      questions: "Questions",
      concept: "Concept",
      prose: "Prose",
    };

    const iconEl = this.contextChipEl.createSpan({ cls: "llm-context-chip-icon" });
    setIcon(iconEl, "file-text");

    this.contextChipEl.createSpan({
      cls: "llm-context-chip-note",
      text: activeView.file.basename,
    });

    const typeEl = this.contextChipEl.createSpan({ cls: "llm-context-chip-type" });
    const typeIconEl = typeEl.createSpan({ cls: "llm-context-chip-type-icon" });
    setIcon(typeIconEl, contextIcons[context]);
    typeEl.createSpan({ text: contextLabels[context] });

    // X button — dismiss note context, switch to Whole Vault mode
    const dismissBtn = this.contextChipEl.createEl("button", {
      cls: "llm-context-chip-dismiss",
      attr: { "aria-label": "Dismiss — chat with Whole Vault" },
    });
    setIcon(dismissBtn, "x");
    dismissBtn.addEventListener("click", () => {
      this.contextDismissed = true;
      this.updateContextChip();
      this.renderQuickActionButtons();
    });
  }

  /**
   * Get a context-specific system prompt addition for quick actions.
   */
  private getContextSystemPromptAddition(context: "code" | "tasks" | "questions" | "concept" | "prose"): string {
    switch (context) {
      case "code":
        return "You are a senior software engineer. Be precise, practical, and show code examples where relevant.";
      case "tasks":
        return "You are a skilled project manager and productivity coach. Be concise, actionable, and prioritize clarity.";
      case "questions":
        return "You are a knowledgeable research assistant. Answer questions directly, cite reasoning, and flag uncertainty.";
      case "concept":
        return "You are an expert teacher. Explain concepts clearly, use analogies, and build intuition before detail.";
      default:
        return "You are a clear and concise writing assistant. Focus on structure, clarity, and impact.";
    }
  }

  /**
   * Show follow-up suggestion chips after the last assistant message.
   * Renders skeleton chips immediately, then replaces with AI-generated suggestions.
   */
  private renderFollowUpChips(userPrompt: string, assistantResponse: string) {
    if (!this.messagesContainer) return;

    this.messagesContainer.querySelector(".llm-followup-chips")?.remove();

    const chipsEl = this.messagesContainer.createDiv({ cls: "llm-followup-chips" });

    const attachChip = (text: string) => {
      const chip = chipsEl.createEl("button", { cls: "llm-followup-chip", text });
      chip.addEventListener("click", () => {
        if (!this.inputEl || this.isLoading) return;
        chipsEl.remove();
        this.inputEl.value = text;
        this.sendMessage();
      });
      return chip;
    };

    // Show 3 skeleton placeholders while AI generates
    const skeletons = [1, 2, 3].map(() => {
      const s = chipsEl.createEl("button", { cls: "llm-followup-chip llm-followup-skeleton" });
      s.setText("···");
      return s;
    });

    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

    // Generate suggestions — caller already awaits the main request, so we fire immediately
    this.generateFollowUpSuggestions(userPrompt, assistantResponse)
      .then((suggestions) => {
        if (!chipsEl.isConnected) return;
        skeletons.forEach((s) => s.remove());
        suggestions.forEach((s) => attachChip(s));
        this.messagesContainer!.scrollTop = this.messagesContainer!.scrollHeight;
      })
      .catch(() => {
        if (!chipsEl.isConnected) return;
        skeletons.forEach((s) => s.remove());
        this.getStaticFollowUpSuggestions(userPrompt).forEach((s) => attachChip(s));
      });
  }

  /**
   * Ask the current provider for 3 short follow-up question suggestions.
   */
  private async generateFollowUpSuggestions(userPrompt: string, assistantResponse: string): Promise<string[]> {
    const fullPrompt =
      `Based on this conversation, suggest exactly 3 short follow-up questions the user might want to ask next.\n` +
      `Reply with only the 3 questions, one per line, no numbering or bullets, max 8 words each.\n\n` +
      `User asked: ${userPrompt.slice(0, 300)}\n\nAssistant answered: ${assistantResponse.slice(0, 500)}`;

    let raw = "";
    await this.executor.execute(
      fullPrompt,
      this.currentProvider,
      (chunk) => { raw += chunk; },
      () => {},
    );

    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((l) => l.length > 3 && l.length < 80);

    return lines.slice(0, 3).length === 3
      ? lines.slice(0, 3)
      : this.getStaticFollowUpSuggestions(userPrompt);
  }

  /**
   * Static fallback suggestions when AI generation fails.
   */
  private getStaticFollowUpSuggestions(prompt: string): string[] {
    const lower = prompt.toLowerCase();
    if (lower.includes("summarize") || lower.includes("summary")) {
      return ["Go deeper on the key points", "What's missing from this summary?", "Create action items from this"];
    }
    if (lower.includes("explain") || lower.includes("feynman")) {
      return ["Give a concrete example", "What are common misconceptions?", "How does this connect to related concepts?"];
    }
    if (lower.includes("rewrite") || lower.includes("improve")) {
      return ["Make it more concise", "Make it more formal", "Add more structure with headings"];
    }
    if (lower.includes("code") || lower.includes("review")) {
      return ["How would you refactor this?", "What tests should I write?", "Are there security concerns?"];
    }
    if (lower.includes("task") || lower.includes("prioritize")) {
      return ["What should I tackle first?", "What dependencies are there?", "What can I delegate?"];
    }
    return ["Go deeper", "Give an example", "What's missing?"];
  }

  /**
   * Returns the most recently visible MarkdownView — works even when focus is in the
   * chat sidebar (where getActiveViewOfType returns null because the active leaf is us).
   */
  private getEditorView(): MarkdownView | null {
    // Try the standard path first (works when editor is focused)
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;

    // Fallback: find the most recently used markdown leaf in the main editor area
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    if (leaves.length === 0) return null;
    // Prefer leaves in the root (main editor), not sidebars
    const mainLeaf = leaves.find((l) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parent = (l as any).parent;
      return parent && parent.constructor?.name !== "WorkspaceSidedock";
    });
    const leaf = mainLeaf ?? leaves[0];
    return leaf.view instanceof MarkdownView ? leaf.view : null;
  }

  /**
   * Get the content of the currently active note (the one visible in the editor)
   */
  private getActiveNoteContent(): string | null {
    return this.getEditorView()?.editor.getValue() ?? null;
  }

  /**
   * Get the title of the currently active note
   */
  private getActiveNoteTitle(): string | null {
    return this.getEditorView()?.file?.basename ?? null;
  }

  /**
   * Cancel the current request
   */
  private cancelRequest() {
    this.executor.cancel();
    this.localExecutor.cancel();
    this.acpExecutor.cancel();
    this.isLoading = false;
    this.updateButtonStates();
    this.clearProgress();
    new Notice("Request cancelled");
  }

  /**
   * Update send/cancel button visibility based on loading state
   */
  private updateButtonStates() {
    if (this.sendBtn) {
      this.sendBtn.style.display = this.isLoading ? "none" : "flex";
      this.sendBtn.disabled = this.isLoading;
    }
    if (this.cancelBtn) {
      this.cancelBtn.style.display = this.isLoading ? "flex" : "none";
    }
    if (this.inputEl) {
      this.inputEl.disabled = this.isLoading;
    }
  }

  /**
   * Read the system prompt from the configured file
   */
  private async getSystemPrompt(): Promise<string> {
    // Session override takes precedence over settings value
    const filePath = this.sessionSystemPromptFile ?? this.plugin.settings.systemPromptFile;

    if (filePath) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        new Notice(`System prompt file not found: ${filePath}`);
        return "";
      }
      try {
        return await this.app.vault.cachedRead(file);
      } catch (error) {
        new Notice(`Error reading system prompt file: ${error}`);
        return "";
      }
    }

    // Auto-generate a smart default system prompt
    return this.buildDefaultSystemPrompt();
  }

  /**
   * Get context budget (in chars) based on the current provider's context window.
   */
  private getContextBudget(): number {
    // Budgets are tuned for *time-to-first-token*, not context-window fit.
    // Larger budgets → more input tokens for the model to read before streaming
    // starts, which directly delays the first visible word. Users can raise
    // these via "Deep Vault" mode in the future if needed.
    const budgets: Record<LLMProvider, number> = {
      claude: 15000,
      opencode: 15000,
      gemini: 15000,
      codex: 15000,
      local: 4000,
    };
    return budgets[this.currentProvider] ?? 12000;
  }

  /**
   * Generate a default system prompt with Obsidian context
   */
  private buildDefaultSystemPrompt(): string {
    const parts: string[] = [];
    parts.push(
      "You are an AI assistant inside Obsidian, a knowledge management app. " +
      "The user is working with markdown notes in their vault."
    );

    // Vault info
    const vaultName = this.app.vault.getName();
    if (vaultName) {
      parts.push(`The vault is called "${vaultName}".`);
    }

    // Active note context — skip when user chose "Whole Vault" mode
    if (!this.contextDismissed) {
      const activeView = this.getEditorView();
      const noteTitle = activeView?.file?.basename ?? null;
      if (noteTitle) {
        parts.push(`The user currently has the note "${noteTitle}" open.`);
        const content = activeView?.editor.getValue() ?? "";
        if (content) {
          const context = this.detectNoteContext(content);
          parts.push(this.getContextSystemPromptAddition(context));
        }
      }
    }

    // Formatting guidelines
    parts.push(
      "Guidelines:\n" +
      "- Use [[Note Name]] wiki-link syntax when referencing notes (renders as clickable links)\n" +
      "- Use standard markdown formatting (headings, lists, bold, code blocks)\n" +
      "- Use - [ ] for task items\n" +
      "- Keep responses concise and well-structured\n" +
      "- When asked about note content, focus on what's relevant"
    );

    return parts.join("\n\n");
  }

  private getVaultPath(): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.app.vault.adapter as any).basePath as string | undefined;
  }

  /**
   * Try to start a local LLM server if one is installed but not running.
   * Probes known software (Ollama, LM Studio) and starts the first installed one.
   */
  private async tryStartLocalServer(onProgress: (e: StreamChunk) => void): Promise<boolean> {
    const { detectLocalSoftwareStatuses, startLocalServer } = await import("../utils/autoDetect");
    onProgress({ type: "status", message: "Server starten..." });

    try {
      const statuses = await detectLocalSoftwareStatuses();
      const startable = statuses.find((s) => s.installed && !s.serverRunning && s.canAutoStart);
      if (!startable) {
        onProgress({ type: "status", message: "Kein lokaler Server verfügbar" });
        return false;
      }

      onProgress({ type: "status", message: "Server starten..." });
      new Notice(`Starte ${startable.name}...`);
      const result = await startLocalServer(startable.name);

      if (!result.ok) {
        onProgress({ type: "status", message: "Server konnte nicht gestartet werden" });
        new Notice(`Start fehlgeschlagen: ${result.error}`);
        return false;
      }

      // Update settings to point at the started server
      this.plugin.settings.providers.local.serverUrl = startable.url;
      this.plugin.settings.providers.local.serverType = startable.type;
      if (!this.plugin.settings.providers.local.model && startable.models.length > 0) {
        this.plugin.settings.providers.local.model = startable.models[0];
      }
      await this.plugin.saveSettings();
      this.localExecutor.updateSettings(this.plugin.settings);

      onProgress({ type: "status", message: "Erneut versuchen..." });
      new Notice(`${startable.name} läuft`);
      return true;
    } catch {
      onProgress({ type: "status", message: "Server konnte nicht gestartet werden" });
      return false;
    }
  }

  private connectAcpIfEnabled(): void {
    // Store the target provider at call time to detect if it changes during async operations
    const targetProvider = this.currentProvider;
    const providerConfig = this.plugin.settings.providers[targetProvider];
    const useAcp = providerConfig.useAcp && ACP_SUPPORTED_PROVIDERS.includes(targetProvider);

    if (!useAcp) {
      // Not using ACP - make sure status bar shows configured model (not stale ACP model)
      this.plugin.updateStatusBar(targetProvider);
      // If there was an in-flight ACP connection, reset loading state
      // (the connection will complete in background but input should be usable)
      if (this.acpConnectionPromise && this.isLoading) {
        this.setLoading(false);
        this.clearProgress();
      }
      return;
    }

    // Don't reconnect if already connected to this provider
    if (this.acpExecutor.isConnected() && this.acpExecutor.getProvider() === targetProvider) {
      // Already connected - just update the status bar with model info
      const currentModel = this.acpExecutor.getCurrentModel();
      if (currentModel) {
        this.plugin.updateStatusBar(targetProvider, currentModel.name);
      }
      return;
    }

    // If there's already a connection in progress, let it complete
    // The caller can await acpConnectionPromise if needed
    if (this.acpConnectionPromise) {
      return;
    }

    // Start the connection and track the promise
    this.acpConnectionPromise = this.doConnectAcp(targetProvider);
  }

  /**
   * Internal method that performs the actual ACP connection.
   * Separated to allow tracking the promise.
   */
  private async doConnectAcp(targetProvider: LLMProvider): Promise<void> {
    const vaultPath = this.getVaultPath();

    // Block user input while connecting
    this.setLoading(true);
    this.plugin.updateStatusBar(targetProvider, undefined, "connecting");
    this.handleProgressEvent({ type: "status", message: "Verbinde..." });

    try {
      await this.acpExecutor.connect(targetProvider, vaultPath);

      // Check if provider changed while we were connecting
      if (this.currentProvider !== targetProvider) {
        // Provider changed - disconnect and let the new provider connect
        await this.acpExecutor.disconnect();
        return;
      }

      // Verify connection succeeded
      if (!this.acpExecutor.isConnected()) {
        throw new Error("Connection completed but agent is not responding");
      }

      // Update status bar with actual model from ACP session
      const currentModel = this.acpExecutor.getCurrentModel();
      if (currentModel) {
        this.plugin.updateStatusBar(targetProvider, currentModel.name, "connected");
      } else {
        this.plugin.updateStatusBar(targetProvider, undefined, "connected");
      }

      // Clear the connecting status
      this.clearProgress();
    } catch (err) {
      // Connection failed
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (this.plugin.settings.debugMode) console.error("[ChatView] ACP connection failed:", errorMsg);

      // Ensure we disconnect to clean up any partial state
      await this.acpExecutor.disconnect();

      // Reset status bar to idle state (use targetProvider since that's what we tried to connect)
      this.plugin.updateStatusBar(targetProvider, undefined, "idle");

      // Show error notification
      new Notice(`ACP connection failed: ${errorMsg.slice(0, 100)}`, 5000);

      this.clearProgress();
    } finally {
      this.setLoading(false);
      // Clear the connection promise so future connects can proceed
      this.acpConnectionPromise = null;
    }
  }

  private async sendMessage() {
    if (!this.inputEl || this.isLoading) return;

    const prompt = this.inputEl.value.trim();
    if (!prompt) return;

    // Save input in case of error, then clear
    const savedInput = this.inputEl.value;
    this.inputEl.value = "";

    // Add user message
    const userMessage: ConversationMessage = {
      role: "user",
      content: prompt,
      displayLabel: this.pendingDisplayLabel ?? undefined,
      timestamp: Date.now(),
      provider: this.currentProvider,
    };
    this.pendingDisplayLabel = null;
    this.messages.push(userMessage);
    await this.renderMessagesContent();

    // Show loading state
    this.setLoading(true);

    const debug = this.plugin.settings.debugMode;
    const tSend = debug ? performance.now() : 0;
    let tFirstToken = 0;

    try {
      // Stream callback for real-time text updates
      let streamedContent = "";
      const onStream = (chunk: string) => {
        if (debug && tFirstToken === 0) {
          tFirstToken = performance.now();
          console.log(`[ChatView] time-to-first-token: ${(tFirstToken - tSend).toFixed(0)}ms`);
        }
        streamedContent = chunk; // chunk is cumulative
        this.updateStreamingMessage(streamedContent);
      };

      // Progress callback for tool use/thinking events
      const onProgress = (event: StreamChunk) => {
        this.handleProgressEvent(event);
      };

      const vaultPath = this.getVaultPath();

      // Check if ACP mode is enabled for this provider
      const providerConfig = this.plugin.settings.providers[this.currentProvider];
      // OpenCode ACP uses HTTP transport, not stdio — read-only check, never mutate settings here
      const useAcp = providerConfig.useAcp
        && ACP_SUPPORTED_PROVIDERS.includes(this.currentProvider)
        && this.currentProvider !== "opencode";

      let response: { content: string; provider: LLMProvider; durationMs: number; error?: string; tokensUsed?: { input: number; output: number } };

      if (this.currentProvider === "local") {
        // Use local HTTP executor
        this.localExecutor.updateSettings(this.plugin.settings);

        const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

        const systemContext = await this.buildSystemContext(prompt);
        if (systemContext) {
          chatMessages.push({ role: "system", content: systemContext });
        }

        // Add conversation history
        if (this.plugin.settings.conversationHistory.enabled) {
          const maxMessages = this.plugin.settings.conversationHistory.maxMessages;
          const historyStart = Math.max(0, this.messages.length - 1 - maxMessages);
          for (let i = historyStart; i < this.messages.length - 1; i++) {
            chatMessages.push({
              role: this.messages[i].role as "user" | "assistant",
              content: this.messages[i].content,
            });
          }
        }

        // Add current prompt
        chatMessages.push({ role: "user", content: prompt });

        // Local executor now sends cumulative content (matching CLI/ACP behaviour)
        response = await this.localExecutor.execute(chatMessages, onStream, onProgress);

        // Auto-start local server on connection failure and retry
        if (response.error && /cannot connect|cannot reach|econnrefused|server is running/i.test(response.error)) {
          const started = await this.tryStartLocalServer(onProgress);
          if (started) {
            streamedContent = "";
            response = await this.localExecutor.execute(chatMessages, onStream, onProgress);
          }
        }
      } else if (useAcp) {
        // Use ACP executor for persistent connection
        // Connect if not already connected or provider changed
        if (!this.acpExecutor.isConnected() || this.acpExecutor.getProvider() !== this.currentProvider) {
          onProgress({ type: "status", message: "Verbinde..." });
          await this.acpExecutor.connect(this.currentProvider, vaultPath, { onProgress });

          // Verify connection succeeded (process might have exited)
          if (!this.acpExecutor.isConnected()) {
            throw new Error("ACP agent process exited unexpectedly");
          }

          // Update status bar with actual model from ACP session
          const currentModel = this.acpExecutor.getCurrentModel();
          if (currentModel) {
            this.plugin.updateStatusBar(this.currentProvider, currentModel.name);
          }
        }

        // ACP session keeps history server-side across turns — skip history replay
        // after the first turn. (messages has user+assistant pairs; >=3 means we
        // already had at least one exchange before this new user turn was pushed.)
        const acpSessionActive = this.messages.length >= 3;
        const acpPrompt = await this.buildContextPrompt(prompt, acpSessionActive);

        const acpResponse = await this.acpExecutor.prompt(acpPrompt, { onProgress });

        // Use ACP accumulated content (streamedContent won't be set for ACP mode)
        const content = acpResponse.content;

        // Warn if response is unexpectedly empty
        if (!content && !acpResponse.error) {
          if (this.plugin.settings.debugMode) console.warn("[ChatView] ACP response has no content - this may indicate a problem");
        }

        response = {
          content,
          provider: this.currentProvider,
          durationMs: 0,
          error: acpResponse.error || (!content ? "No response received from agent" : undefined),
        };
      } else {
        // CLI with --resume on claude/gemini/opencode keeps session state server-side.
        // Skip replaying history once a session id is known — avoids doubling input
        // tokens each turn and cuts time-to-first-token.
        const cliSessionActive = this.executor.hasSession(this.currentProvider);
        const cliPrompt = await this.buildContextPrompt(prompt, cliSessionActive);

        response = await this.executor.execute(
          cliPrompt,
          this.currentProvider,
          this.plugin.settings.streamOutput ? onStream : undefined,
          onProgress,
          vaultPath
        );
      }

      if (response.error) {
        // Restore input so user can retry
        if (this.inputEl) this.inputEl.value = savedInput;
        // Remove the user message we already added
        this.messages.pop();
        await this.renderMessagesContent(true);
        this.showError(response.error ?? "Unknown error");
      } else {
        // Remove streaming/progress elements
        this.removeStreamingMessage();
        this.clearProgress();

        // Add assistant message
        const assistantMessage: ConversationMessage = {
          role: "assistant",
          content: response.content,
          timestamp: Date.now(),
          provider: this.currentProvider,
          durationMs: response.durationMs,
          tokensUsed: response.tokensUsed,
        };
        this.messages.push(assistantMessage);

        // Auto-name tab from first user message (if still default name)
        const activeTab = this.chatTabs.find((t) => t.id === this.activeChatId);
        if (activeTab && /^Chat \d+$/.test(activeTab.name) && this.messages.length === 2) {
          const firstUser = this.messages[0].content;
          activeTab.name = firstUser.slice(0, 30).replace(/\n/g, " ").trim() + (firstUser.length > 30 ? "…" : "");
          this.renderTabs();
        }

        await this.renderMessagesContent();
        // Auto-save after each exchange
        await this.persistSessions();

        // Run pending action callback (e.g. save summary, rewrite note)
        if (this.pendingActionCallback) {
          const cb = this.pendingActionCallback;
          this.pendingActionCallback = null;
          try {
            await cb(response.content);
          } catch (err) {
            new Notice(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Show follow-up suggestion chips (AI-generated)
        this.renderFollowUpChips(prompt, response.content);
      }
    } catch (error) {
      // Restore input so user can retry
      if (this.inputEl) this.inputEl.value = savedInput;
      // Remove the user message we already added
      this.messages.pop();
      await this.renderMessagesContent(true);
      this.showError(error instanceof Error ? error.message : String(error));
    } finally {
      this.setLoading(false);
      this.clearProgress();
    }
  }

  /**
   * Handle progress events from the LLM executor
   */
  private handleProgressEvent(event: StreamChunk) {
    if (!this.messagesContainer) return;

    // Ensure progress container exists (it should already from setLoading, but just in case)
    if (!this.progressContainer) {
      this.progressContainer = this.messagesContainer.createDiv({
        cls: "llm-progress-container",
      });
    }

    switch (event.type) {
      case "tool_use": {
        // Finalize any open thinking block when tools start
        this.finalizeThinkingBlock();
        this.clearThinkingDebounce();

        const toolDisplay = event.input
          ? `${event.tool}: ${event.input}`
          : event.tool;
        // Add to tool history if not a duplicate of the last one
        if (this.toolHistory[this.toolHistory.length - 1] !== toolDisplay) {
          this.toolHistory.push(toolDisplay);
        }
        this.renderToolCall(event.tool, event.input, event.status);

        // Nudge vault after file-writing tools complete
        if (event.status === "completed" && event.input && this.isEditTool(event.tool)) {
          this.notifyVaultFileChange(event.input);
        }
        break;
      }

      case "thinking": {
        this.clearThinkingDebounce();
        this.appendThinkingContent(event.content || "Thinking...");
        break;
      }

      case "status":
        this.updateProgressDisplay(event.message, "status");
        break;

      case "text":
        // Finalize thinking block when text starts
        this.finalizeThinkingBlock();
        this.clearThinkingDebounce();
        // Text events contain cumulative content - update streaming display
        if (event.content) {
          this.updateStreamingMessage(event.content);
        }
        break;

      case "error":
        this.updateProgressDisplay(`⚠ ${event.message}`, "status");
        break;

      case "done":
        this.finalizeThinkingBlock();
        break;

      case "usage":
        // Token usage info — could be displayed in status bar in the future
        break;
    }
  }

  /**
   * Collapse consecutive repeated tools into counts
   * e.g., ["glob: *.md", "glob: *.ts", "read: file.md", "read: other.md"]
   *    -> [{ name: "glob", detail: "*.md", count: 2 }, { name: "read", detail: "file.md", count: 2 }]
   * Preserves detail from first occurrence for display
   */
  private collapsedToolHistory(): { name: string; detail?: string; count: number }[] {
    const collapsed: { name: string; detail?: string; count: number }[] = [];

    for (const tool of this.toolHistory) {
      const colonIdx = tool.indexOf(":");
      const toolName = colonIdx > 0 ? tool.slice(0, colonIdx).trim() : tool;
      const detail = colonIdx > 0 ? tool.slice(colonIdx + 1).trim() : undefined;
      const last = collapsed[collapsed.length - 1];

      if (last && last.name === toolName) {
        last.count++;
      } else {
        collapsed.push({ name: toolName, detail, count: 1 });
      }
    }

    return collapsed;
  }

  /**
   * Check if a string looks like a file path
   */
  private isFilePath(str: string): boolean {
    // Matches absolute paths, relative paths, and common file extensions
    return /^[\/~.]/.test(str) || /\.[a-zA-Z0-9]{1,6}$/.test(str) || str.includes("/");
  }

  /**
   * Create a clickable file path element
   */
  private createFileLink(container: HTMLElement, filePath: string, prefix?: string) {
    if (prefix) {
      container.createSpan({ text: prefix });
    }

    const link = container.createEl("a", {
      text: filePath,
      cls: "llm-file-link",
      attr: { href: "#" },
    });

    link.addEventListener("click", (e) => {
      e.preventDefault();
      const vaultPath = this.getVaultPath() ?? "";
      let relativePath = filePath;

      // If it's an absolute path, try to make it relative to the vault
      if (filePath.startsWith("/") && vaultPath && filePath.startsWith(vaultPath)) {
        relativePath = filePath.slice(vaultPath.length + 1);
      }

      // Try to open as a vault file
      const file = this.app.vault.getAbstractFileByPath(relativePath);
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf(false);
        leaf.openFile(file);
      } else {
        // Fallback: try opening as link text
        this.app.workspace.openLinkText(relativePath, "");
      }
    });
  }

  /**
   * Update the progress display with tool history and current status
   */
  private updateProgressDisplay(message: string, type: "tool" | "thinking" | "status") {
    if (!this.progressContainer) return;

    this.progressContainer.empty();

    // Show collapsed tool history if we have any - each tool on its own line
    const collapsed = this.collapsedToolHistory();
    if (collapsed.length > 0) {
      const historyEl = this.progressContainer.createDiv({ cls: "llm-progress-history" });

      // Show tools with checkmarks for completed ones, each on its own line
      // All but the last are complete, last is current/in-progress
      collapsed.forEach((item, i) => {
        const isLast = i === collapsed.length - 1;
        const toolLine = historyEl.createDiv({ cls: "llm-tool-history-item" });

        // Add checkmark for completed items, spinner for in-progress
        if (!isLast) {
          toolLine.createSpan({ text: "✓ ", cls: "llm-tool-complete" });
        } else {
          toolLine.createSpan({ text: "› ", cls: "llm-tool-active" });
        }

        if (item.count > 1) {
          toolLine.createSpan({ text: `${item.name} `, cls: "llm-tool-name" });
          toolLine.createSpan({ text: `(${item.count}×)`, cls: "llm-tool-count" });
        } else if (item.detail && this.isFilePath(item.detail)) {
          // Make file paths clickable
          toolLine.createSpan({ text: `${item.name}: `, cls: "llm-tool-name" });
          this.createFileLink(toolLine, item.detail);
        } else if (item.detail) {
          toolLine.createSpan({ text: `${item.name}: `, cls: "llm-tool-name" });
          toolLine.createSpan({ text: item.detail, cls: "llm-tool-detail" });
        } else {
          toolLine.createSpan({ text: item.name, cls: "llm-tool-name" });
        }
      });
    }

    // Show current status with details
    const iconName = type === "tool" ? "wrench" : type === "thinking" ? "brain" : "loader";
    const progressEl = this.progressContainer.createDiv({ cls: `llm-progress llm-progress-${type}` });
    const iconEl = progressEl.createSpan({ cls: "llm-progress-icon" });
    setIcon(iconEl, iconName);

    // Check if the message contains a file path (e.g., "Read: /path/to/file.ts")
    const colonIdx = message.indexOf(":");
    if (colonIdx > 0) {
      const toolPart = message.slice(0, colonIdx + 1);
      const detailPart = message.slice(colonIdx + 1).trim();
      if (this.isFilePath(detailPart)) {
        const textEl = progressEl.createSpan({ cls: "llm-progress-text" });
        textEl.createSpan({ text: toolPart + " " });
        this.createFileLink(textEl, detailPart);
      } else {
        progressEl.createSpan({ text: message, cls: "llm-progress-text" });
      }
    } else {
      progressEl.createSpan({ text: message, cls: "llm-progress-text" });
    }

    this.messagesContainer!.scrollTop = this.messagesContainer!.scrollHeight;
  }

  /**
   * Clear the progress display
   */
  private clearProgress() {
    this.finalizeThinkingBlock();
    this.clearThinkingDebounce();
    if (this.progressContainer) {
      this.progressContainer.remove();
      this.progressContainer = null;
    }
    this.toolHistory = [];
  }

  // ─── Thinking Block ─────────────────────────────────────────────

  /**
   * Create or append to the thinking block with live timer.
   * Pattern from Claudian (MIT).
   */
  private appendThinkingContent(content: string) {
    if (!this.progressContainer) return;

    // Create thinking block on first call
    if (!this.thinkingBlockEl) {
      this.thinkingBlockEl = this.progressContainer.createDiv({ cls: "llm-thinking-block" });
      this.thinkingHeaderEl = this.thinkingBlockEl.createDiv({ cls: "llm-thinking-header" });

      const iconEl = this.thinkingHeaderEl.createSpan({ cls: "llm-thinking-icon" });
      setIcon(iconEl, "brain");
      iconEl.setAttribute("aria-hidden", "true");

      this.thinkingLabelEl = this.thinkingHeaderEl.createSpan({
        cls: "llm-thinking-label",
        text: "Thinking 0s...",
      });

      this.thinkingContentEl = this.thinkingBlockEl.createDiv({ cls: "llm-thinking-content" });
      this.thinkingState = { expanded: false };

      setupCollapsible(this.thinkingBlockEl, this.thinkingHeaderEl, this.thinkingContentEl, this.thinkingState, {
        initiallyExpanded: false,
        baseAriaLabel: "Extended thinking",
      });

      // Start timer
      this.thinkingStartTime = Date.now();
      this.thinkingTimerInterval = setInterval(() => {
        // Self-clean if element was removed from DOM
        if (!this.thinkingLabelEl?.isConnected) {
          this.clearThinkingTimer();
          return;
        }
        const elapsed = Math.floor((Date.now() - (this.thinkingStartTime ?? Date.now())) / 1000);
        this.thinkingLabelEl.setText(`Thinking ${elapsed}s...`);
      }, 1000);
    }

    // Append content
    if (this.thinkingContentEl) {
      this.thinkingContentEl.setText(content.slice(0, 500) + (content.length > 500 ? "..." : ""));
    }

    this.messagesContainer!.scrollTop = this.messagesContainer!.scrollHeight;
  }

  /**
   * Finalize the thinking block: stop timer, show duration, auto-collapse.
   */
  private finalizeThinkingBlock() {
    if (!this.thinkingBlockEl || !this.thinkingHeaderEl || !this.thinkingContentEl) return;

    this.clearThinkingTimer();
    const elapsed = this.thinkingStartTime
      ? Math.floor((Date.now() - this.thinkingStartTime) / 1000)
      : 0;

    if (this.thinkingLabelEl) {
      this.thinkingLabelEl.setText(`Thought for ${elapsed}s`);
    }

    // Auto-collapse
    collapseElement(this.thinkingBlockEl, this.thinkingHeaderEl, this.thinkingContentEl, this.thinkingState, "Extended thinking");

    // Reset state for next thinking block
    this.thinkingBlockEl = null;
    this.thinkingHeaderEl = null;
    this.thinkingContentEl = null;
    this.thinkingLabelEl = null;
    this.thinkingStartTime = null;
  }

  private clearThinkingTimer() {
    if (this.thinkingTimerInterval) {
      clearInterval(this.thinkingTimerInterval);
      this.thinkingTimerInterval = null;
    }
  }

  /**
   * Clear the 400ms thinking debounce timer.
   */
  private clearThinkingDebounce() {
    if (this.thinkingDebounceTimer) {
      clearTimeout(this.thinkingDebounceTimer);
      this.thinkingDebounceTimer = null;
    }
  }

  // ─── Tool Call Rendering ────────────────────────────────────────

  /**
   * Render a tool call as a collapsible block with ARIA support.
   */
  private renderToolCall(tool: string, input?: string, status?: "started" | "completed") {
    if (!this.progressContainer) return;

    const toolEl = this.progressContainer.createDiv({ cls: "llm-tool-block" });
    const header = toolEl.createDiv({ cls: "llm-tool-header" });

    // Icon
    const iconEl = header.createSpan({ cls: "llm-tool-icon" });
    setIcon(iconEl, this.getToolIcon(tool));
    iconEl.setAttribute("aria-hidden", "true");

    // Tool name
    header.createSpan({ text: tool, cls: "llm-tool-name" });

    // Summary (file path, pattern, etc.)
    if (input) {
      header.createSpan({ text: input, cls: "llm-tool-summary" });
    }

    // Status badge
    const statusEl = header.createSpan({ cls: `llm-tool-status llm-tool-status-${status ?? "started"}` });
    const statusText = status === "completed" ? "done" : "running";
    statusEl.setText(statusText);
    statusEl.setAttribute("aria-label", `Status: ${statusText}`);

    // Content area (expandable)
    const contentEl = toolEl.createDiv({ cls: "llm-tool-block-content" });
    if (input && this.isFilePath(input)) {
      this.createFileLink(contentEl, input);
    }

    // Wire up collapsible
    const state = { expanded: false };
    const ariaLabel = input ? `${tool}: ${input}` : tool;
    setupCollapsible(toolEl, header, contentEl, state, { baseAriaLabel: ariaLabel });

    this.messagesContainer!.scrollTop = this.messagesContainer!.scrollHeight;
  }

  /**
   * Get an appropriate icon for a tool type.
   */
  private getToolIcon(tool: string): string {
    const t = tool.toLowerCase();
    if (t.includes("read") || t.includes("cat")) return "file-text";
    if (t.includes("write") || t.includes("edit") || t.includes("patch")) return "pencil";
    if (t.includes("bash") || t.includes("exec") || t.includes("command")) return "terminal";
    if (t.includes("glob") || t.includes("find") || t.includes("search") || t.includes("grep")) return "search";
    if (t.includes("web") || t.includes("fetch") || t.includes("http")) return "globe";
    if (t.includes("list") || t.includes("ls") || t.includes("dir")) return "folder";
    return "wrench";
  }

  // ─── File Nudge ──────────────────────────────────────────────────

  /**
   * Check if a tool name is a file-editing tool.
   */
  private isEditTool(tool: string): boolean {
    const t = tool.toLowerCase();
    return t.includes("write") || t.includes("edit") || t.includes("patch")
      || t.includes("create") || t.includes("save") || t === "applypatch";
  }

  /**
   * Notify Obsidian's vault API that a file was changed by an external tool.
   * GUI Obsidian's FSWatcher on macOS (especially with iCloud) often misses
   * direct fs writes. 200ms defer lets the filesystem settle first.
   * Pattern from Claudian (MIT).
   */
  private notifyVaultFileChange(filePath: string) {
    const vaultPath = this.getVaultPath() ?? "";
    let relativePath = filePath;

    // Convert absolute path to vault-relative
    if (filePath.startsWith("/") && vaultPath && filePath.startsWith(vaultPath)) {
      relativePath = filePath.slice(vaultPath.length).replace(/^\//, "");
    }

    setTimeout(() => {
      const file = this.app.vault.getAbstractFileByPath(relativePath);
      if (file instanceof TFile) {
        // Existing file — trigger modify event so Obsidian re-reads it
        this.app.vault.trigger("modify", file);
      } else {
        // New file — scan parent directory so Obsidian discovers it
        const parentDir = relativePath.includes("/")
          ? relativePath.slice(0, relativePath.lastIndexOf("/"))
          : "";
        this.app.vault.adapter.list(parentDir).catch(() => { /* ignore */ });
      }
    }, 200);
  }

  /**
   * Resolve [[Note]] references in a prompt — read referenced notes and
   * return their content as a context block.
   */
  private async resolveNoteReferences(prompt: string): Promise<string> {
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    const matches = [...prompt.matchAll(wikiLinkRegex)];
    if (matches.length === 0) return "";

    const parts: string[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
      const linkText = match[1];
      if (seen.has(linkText)) continue;
      seen.add(linkText);

      // Resolve the link to a file
      const file = this.app.metadataCache.getFirstLinkpathDest(linkText, "");
      if (!(file instanceof TFile)) continue;

      try {
        const content = await this.app.vault.cachedRead(file);
        if (content.trim()) {
          parts.push(`=== Referenced note: ${file.basename} (${file.path}) ===\n${content}`);
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (parts.length === 0) return "";
    return parts.join("\n\n");
  }

  /**
   * Gather system context: system prompt, pinned note, referenced notes, vault RAG.
   */
  private async buildSystemContext(prompt: string): Promise<string> {
    const skipRag = this.pendingSkipRag;
    this.pendingSkipRag = false;
    const indexNotReady = !this.vaultSearch.isReady;
    const debug = this.plugin.settings.debugMode;
    const t0 = debug ? performance.now() : 0;

    const [systemPrompt, referencedNotes, vaultContext] = await Promise.all([
      this.getSystemPrompt(),
      this.resolveNoteReferences(prompt),
      skipRag || indexNotReady
        ? Promise.resolve("")
        : this.vaultSearch.buildContext(prompt, this.getContextBudget()),
    ]);

    if (debug) {
      const totalChars = systemPrompt.length + referencedNotes.length + vaultContext.length;
      console.log(
        `[ChatView] buildSystemContext: ${(performance.now() - t0).toFixed(1)}ms` +
        ` | system=${systemPrompt.length} refs=${referencedNotes.length} vault=${vaultContext.length} total=${totalChars}` +
        ` | skipRag=${skipRag} indexReady=${!indexNotReady}`
      );
    }
    const parts: string[] = [];
    if (systemPrompt) parts.push(systemPrompt);

    // Pinned note — always included verbatim, not via RAG (unless user chose Whole Vault)
    if (this.pinnedNote && !this.contextDismissed) {
      try {
        const content = await this.app.vault.cachedRead(this.pinnedNote);
        if (content.trim()) {
          parts.push(`=== Pinned note: ${this.pinnedNote.basename} (${this.pinnedNote.path}) ===\n${content}`);
        }
      } catch {
        // File disappeared — silently skip
      }
    }

    if (referencedNotes) parts.push(referencedNotes);
    if (vaultContext) parts.push(vaultContext);
    return parts.join("\n\n");
  }

  /**
   * Build the full prompt sent to the model.
   * @param currentPrompt User's new message
   * @param sessionActive When true, the transport keeps its own server-side history
   *   (CLI --resume with existing session, or persistent ACP session). We skip
   *   re-sending conversation history to avoid doubling input tokens each turn,
   *   which directly hurts time-to-first-token.
   */
  private async buildContextPrompt(currentPrompt: string, sessionActive = false): Promise<string> {
    const systemContext = await this.buildSystemContext(currentPrompt);

    const contextParts: string[] = [];

    if (systemContext) {
      contextParts.push(`System: ${systemContext}`);
    }

    // Only replay conversation history when the transport does NOT persist it itself
    if (
      !sessionActive &&
      this.plugin.settings.conversationHistory.enabled &&
      this.messages.length > 1
    ) {
      const maxMessages = this.plugin.settings.conversationHistory.maxMessages;
      const recentMessages = this.messages.slice(-maxMessages - 1, -1);

      recentMessages.forEach((msg) => {
        const role = msg.role === "user" ? "User" : "Assistant";
        contextParts.push(`${role}: ${msg.content}`);
      });
    }

    // Add current prompt
    contextParts.push(`User: ${currentPrompt}`);

    return contextParts.join("\n\n");
  }

  private setLoading(loading: boolean) {
    this.isLoading = loading;
    this.updateButtonStates();

    if (loading && this.messagesContainer) {
      // Create progress container immediately with initial "Processing..." status
      // This ensures there's always visible feedback even if progress events are delayed
      if (!this.progressContainer) {
        this.progressContainer = this.messagesContainer.createDiv({
          cls: "llm-progress-container",
        });
      }
      this.updateProgressDisplay("Processing...", "status");

      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    } else if (!loading && this.messagesContainer) {
      // Remove loading indicator if it exists
      const loadingEl = this.messagesContainer.querySelector(".llm-loading");
      loadingEl?.remove();
    }
  }

  /**
   * Queue a streaming content update. Multiple calls in the same frame
   * collapse to a single render via requestAnimationFrame. The expensive
   * MarkdownRenderer.render() path only runs when markdown syntax is
   * detected — plain-text runs use a cheap textContent update.
   */
  private updateStreamingMessage(content: string) {
    this.pendingStreamingContent = content;
    if (this.streamingRafHandle !== null) return;
    this.streamingRafHandle = requestAnimationFrame(() => {
      this.streamingRafHandle = null;
      const pending = this.pendingStreamingContent;
      this.pendingStreamingContent = null;
      if (pending !== null) void this.flushStreamingMessage(pending);
    });
  }

  private async flushStreamingMessage(content: string) {
    if (!this.messagesContainer) return;

    let streamingEl = this.messagesContainer.querySelector(
      ".llm-message-streaming"
    ) as HTMLElement;

    if (!streamingEl) {
      // Remove loading indicator
      const loadingEl = this.messagesContainer.querySelector(".llm-loading");
      loadingEl?.remove();

      // Create streaming message element
      streamingEl = this.messagesContainer.createDiv({
        cls: "llm-message llm-message-assistant llm-message-streaming",
      });

      const avatarEl = streamingEl.createDiv({ cls: "llm-message-avatar" });
      setIcon(avatarEl, "bot");

      const bodyEl = streamingEl.createDiv({ cls: "llm-message-body" });
      const headerEl = bodyEl.createDiv({ cls: "llm-message-header" });
      headerEl.createSpan({
        text: PROVIDER_DISPLAY_NAMES[this.currentProvider],
        cls: "llm-message-role",
      });
      headerEl.createSpan({ text: "...", cls: "llm-message-time" });

      const bubbleEl = bodyEl.createDiv({ cls: "llm-message-bubble" });
      bubbleEl.createDiv({ cls: "llm-message-content" });
      this.streamingMarkdownPossible = false;
    }

    const contentEl = streamingEl.querySelector(".llm-message-content") as HTMLElement;
    if (contentEl) {
      const cleanContent = content.replace(/▋/g, "");

      // Sticky markdown detection: once we see markdown syntax, keep rendering as markdown.
      // Common markers: fenced code, inline code, bold/italic, headings, lists, links, blockquotes.
      if (!this.streamingMarkdownPossible && /[`*_#>\[\]]|^\s*[-*+]\s|^\s*\d+\.\s/m.test(cleanContent)) {
        this.streamingMarkdownPossible = true;
      }

      if (this.streamingMarkdownPossible) {
        contentEl.empty();
        const activeFile = this.app.workspace.getActiveFile();
        const sourcePath = activeFile?.path ?? "";

        const component = new Component();
        component.load();
        await MarkdownRenderer.render(
          this.app,
          cleanContent,
          contentEl,
          sourcePath,
          component
        );
        component.unload();
      } else {
        // Plain-text fast path — no markdown parse, much cheaper
        contentEl.textContent = cleanContent;
      }
      // Cursor is rendered via CSS ::after on .llm-message-streaming, so it
      // doesn't flicker when the content is rebuilt each frame.
    }

    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private removeStreamingMessage() {
    // Cancel any pending throttled render so it can't resurrect the element
    if (this.streamingRafHandle !== null) {
      cancelAnimationFrame(this.streamingRafHandle);
      this.streamingRafHandle = null;
    }
    this.pendingStreamingContent = null;
    this.streamingMarkdownPossible = false;
    if (!this.messagesContainer) return;
    const streamingEl = this.messagesContainer.querySelector(
      ".llm-message-streaming"
    );
    streamingEl?.remove();
  }

  private showError(message: string) {
    if (!this.messagesContainer) return;

    const errorEl = this.messagesContainer.createDiv({ cls: "llm-error-message" });

    const textEl = errorEl.createSpan({ text: `Error: ${message} ` });

    // Add actionable "Open Settings" link for configuration-related errors
    if (/not enabled|not installed|not found|not in path|authentication|api key|no model|enoent/i.test(message)) {
      const link = textEl.createEl("a", {
        text: "Open Settings",
        cls: "llm-error-settings-link",
        attr: { href: "#" },
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
        setting.open();
        setting.openTabById("obsidian-llm");
      });
    }

    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  /**
   * Attach change handlers to checkboxes in rendered markdown
   * When a checkbox is toggled, update the message and notify the LLM
   */
  private attachCheckboxHandlers(contentEl: HTMLElement, msg: ConversationMessage) {
    // Find all checkbox inputs (Obsidian renders task lists with data-task attribute)
    const checkboxes = contentEl.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"], .task-list-item-checkbox'
    );

    checkboxes.forEach((checkbox) => {
      // Make checkbox interactive (Obsidian may disable them by default)
      checkbox.removeAttribute("disabled");
      checkbox.style.cursor = "pointer";

      checkbox.addEventListener("change", () => {
        const isChecked = checkbox.checked;

        // Get the task text from the parent list item
        const listItem = checkbox.closest("li");
        if (!listItem) return;

        // Get text content, excluding the checkbox itself
        const taskText = this.getTaskText(listItem);
        if (!taskText) return;

        // Update the message content
        this.updateCheckboxInMessage(msg, taskText, isChecked);

        // Notify the LLM about the change
        this.notifyCheckboxChange(taskText, isChecked);
      });
    });
  }

  /**
   * Extract task text from a list item, excluding checkbox
   */
  private getTaskText(listItem: HTMLElement): string {
    // Clone the element to avoid modifying the DOM
    const clone = listItem.cloneNode(true) as HTMLElement;

    // Remove checkbox from clone
    const checkbox = clone.querySelector('input[type="checkbox"]');
    checkbox?.remove();

    // Get text content and clean it up
    return clone.textContent?.trim() ?? "";
  }

  /**
   * Update a checkbox state in the message content
   */
  private updateCheckboxInMessage(msg: ConversationMessage, taskText: string, isChecked: boolean) {
    const lines = msg.content.split("\n");
    const escapedText = taskText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Match task list items: - [ ] text or - [x] text (case insensitive for x)
    const uncheckedPattern = new RegExp(`^(\\s*[-*]\\s*)\\[ \\]\\s*${escapedText}`, "i");
    const checkedPattern = new RegExp(`^(\\s*[-*]\\s*)\\[[xX]\\]\\s*${escapedText}`, "i");

    for (let i = 0; i < lines.length; i++) {
      if (isChecked && uncheckedPattern.test(lines[i])) {
        // Change [ ] to [x]
        lines[i] = lines[i].replace("[ ]", "[x]");
        break;
      } else if (!isChecked && checkedPattern.test(lines[i])) {
        // Change [x] to [ ]
        lines[i] = lines[i].replace(/\[[xX]\]/, "[ ]");
        break;
      }
    }

    msg.content = lines.join("\n");
  }

  /**
   * Attach click handlers to buttons in rendered markdown
   */
  private attachButtonHandlers(contentEl: HTMLElement) {
    const buttons = contentEl.querySelectorAll<HTMLButtonElement>("button");

    buttons.forEach((button) => {
      button.addEventListener("click", (e) => {
        e.preventDefault();
        const buttonText = button.textContent?.trim() ?? "";
        if (buttonText) {
          this.notifyButtonClick(buttonText);
        }
      });
    });
  }

  /**
   * Send a message to the LLM about a button click
   */
  private notifyButtonClick(buttonText: string) {
    const message = `[clicked: "${buttonText}"]`;

    if (this.inputEl && !this.isLoading) {
      this.inputEl.value = message;
      this.sendMessage();
    }
  }

  /**
   * Send a message to the LLM about a checkbox change
   */
  private notifyCheckboxChange(itemText: string, isChecked: boolean) {
    const action = isChecked ? "checked" : "unchecked";
    const message = `[${action}: "${itemText}"]`;

    if (this.inputEl && !this.isLoading) {
      this.inputEl.value = message;
      this.sendMessage();
    }
  }

  /**
   * Create a new note from an LLM response.
   * - Places the note in the same folder as the source note (pinned or active), or vault root.
   * - Adds frontmatter linking back to the source note and recording the provider.
   * - Shows a transparent notice with the full path after creation.
   */
  private async createNoteFromMessage(msg: ConversationMessage) {
    // Determine title: prefer the user's preceding prompt, fall back to first content line
    const msgIndex = this.messages.indexOf(msg);
    const precedingUser = msgIndex > 0 ? this.messages[msgIndex - 1] : null;
    const titleSource =
      precedingUser?.role === "user"
        ? precedingUser.content.split("\n")[0]
        : msg.content.split("\n")[0];

    let title = titleSource
      .replace(/^#+\s*/, "")           // strip markdown headers
      .replace(/\*\*(.+?)\*\*/g, "$1") // strip bold
      .replace(/\*(.+?)\*/g, "$1")     // strip italic
      .replace(/_(.+?)_/g, "$1")       // strip underscore italic
      .replace(/`(.+?)`/g, "$1")       // strip inline code
      .replace(/[\\/*?"<>|:]/g, "")    // strip invalid filename chars
      .trim();
    if (title.length > 60) title = title.slice(0, 57) + "...";
    if (!title) title = `AI Note ${new Date(msg.timestamp).toLocaleDateString()}`;

    // Determine target folder from pinned note, then active editor note
    const sourceFile = this.pinnedNote ?? this.getEditorView()?.file ?? null;
    const folder = sourceFile
      ? sourceFile.path.includes("/")
        ? sourceFile.path.substring(0, sourceFile.path.lastIndexOf("/"))
        : ""
      : "";

    // Build frontmatter — escape basename so colons/quotes don't break YAML
    const dateStr = new Date(msg.timestamp).toISOString().slice(0, 10);
    const providerName = PROVIDER_DISPLAY_NAMES[msg.provider] ?? msg.provider;
    const safeBasename = sourceFile
      ? sourceFile.basename.replace(/"/g, '\\"')
      : null;
    const sourceLink = safeBasename ? `"[[${safeBasename}]]"` : "~";
    const frontmatter = [
      "---",
      `source: ${sourceLink}`,
      `created-by: "${providerName.replace(/"/g, '\\"')}"`,
      `date: ${dateStr}`,
      "---",
      "",
    ].join("\n");

    // Find unique filename in target folder
    const baseName = folder ? `${folder}/${title}` : title;
    let fileName = `${baseName}.md`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(fileName)) {
      fileName = `${baseName} ${counter}.md`;
      counter++;
    }

    try {
      // Ensure the target folder exists before creating the file
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
      const file = await this.app.vault.create(fileName, frontmatter + msg.content);

      // Inline badge on the message body — shows where it was saved
      const msgEl = this.messagesContainer?.querySelector(
        `[data-msg-id="${msg.timestamp}"]`
      ) as HTMLElement | null;
      const badgeTarget = (msgEl?.querySelector(".llm-message-body") ?? msgEl) as HTMLElement | null;
      if (badgeTarget) {
        const existing = badgeTarget.querySelector(".llm-saved-badge");
        if (!existing) {
          const badge = badgeTarget.createDiv({ cls: "llm-saved-badge" });
          setIcon(badge.createSpan({ cls: "llm-saved-badge-icon" }), "file-check");
          badge.createSpan({ cls: "llm-saved-badge-path", text: file.path });
          badge.addEventListener("click", async () => {
            const f = this.app.vault.getAbstractFileByPath(file.path);
            if (f instanceof TFile) {
              await this.app.workspace.getLeaf(false).openFile(f);
            }
          });
        }
      }

      new Notice(`Gespeichert: ${file.path}`, 4000);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (error) {
      new Notice(`Fehler beim Erstellen der Notiz: ${error}`);
    }
  }

  /**
   * Add a message exchange from an external source (e.g., QuickPromptModal)
   * This allows other parts of the plugin to add messages to the chat history
   */
  async addMessageExchange(userMessage: string, assistantMessage: string, provider: LLMProvider) {
    // Add user message
    this.messages.push({
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
      provider,
    });

    // Add assistant message
    this.messages.push({
      role: "assistant",
      content: assistantMessage,
      timestamp: Date.now(),
      provider,
    });

    // Re-render messages and save
    await this.renderMessagesContent();
    await this.persistSessions();
  }
}
