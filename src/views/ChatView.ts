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
    this.vaultSearch.ensureIndex();

    // Eagerly connect to ACP if enabled for the current provider
    this.connectAcpIfEnabled();
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

    // Provider dropdown
    this.providerSelectEl = selectorRow.createEl("select", { cls: "llm-provider-select" });
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
    this.modelSelectEl = selectorRow.createEl("select", { cls: "llm-model-select" });
    this.modelSelectEl.addEventListener("change", async () => {
      const newModel = this.modelSelectEl!.value;
      this.plugin.settings.providers[this.currentProvider].model = newModel || undefined;
      await this.plugin.saveSettings();
      this.plugin.updateStatusBar(this.currentProvider);
    });
    this.refreshModelSelect();

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

  private createNewChat(): string {
    const id = `chat-${Date.now()}`;
    const num = this.chatTabs.length + 1;
    this.chatTabs.push({ id, name: `Chat ${num}`, messages: [] });
    this.activeChatId = id;
    this.messages = this.chatTabs[this.chatTabs.length - 1].messages;
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
      // Save current
      const current = this.chatTabs.find((t) => t.id === this.activeChatId);
      if (current) current.messages = this.messages;
      this.createNewChat();
      this.renderTabs();
      this.renderMessagesContent(true);
      this.persistSessions();
      this.inputEl?.focus();
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
    });

    const headerEl = msgEl.createDiv({ cls: "llm-message-header" });
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

    const contentEl = msgEl.createDiv({ cls: "llm-message-content" });

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
    } else {
      contentEl.setText(msg.content);
    }

    // Scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private renderInput(container: HTMLElement) {
    const inputContainer = container.createDiv({ cls: "llm-chat-input-container" });

    // Quick action buttons
    this.renderQuickActions(inputContainer);

    this.inputEl = inputContainer.createEl("textarea", {
      cls: "llm-chat-input",
      attr: {
        placeholder: "Ask anything about your notes... (Enter to send)",
        rows: "1",
      },
    });

    // Auto-grow textarea as user types
    const autoGrow = () => {
      if (!this.inputEl) return;
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + "px";
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

    const buttonRow = inputContainer.createDiv({ cls: "llm-input-buttons" });

    this.sendBtn = buttonRow.createEl("button", {
      text: "Send",
      cls: "llm-chat-send mod-cta",
    });
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    this.cancelBtn = buttonRow.createEl("button", {
      text: "Cancel",
      cls: "llm-chat-cancel",
    });
    this.cancelBtn.style.display = "none";
    this.cancelBtn.addEventListener("click", () => this.cancelRequest());
  }

  /**
   * Quick action buttons above the input — common tasks with one click
   */
  private renderQuickActions(container: HTMLElement) {
    const actions = container.createDiv({ cls: "llm-quick-actions" });

    const quickActions = [
      { label: "Summarize", icon: "file-text", prompt: "Summarize the current note concisely. Keep the key points and structure." },
      { label: "Rewrite", icon: "pen-line", prompt: "Rewrite the current note more clearly and professionally. Keep the meaning, improve the structure and wording." },
      { label: "Translate", icon: "languages", prompt: "Translate the current note. If it's in German, translate to English. If it's in English, translate to German. Keep formatting intact." },
    ];

    for (const action of quickActions) {
      const btn = actions.createEl("button", {
        cls: "llm-quick-action-btn",
        attr: { "aria-label": action.label },
      });
      setIcon(btn, action.icon);
      btn.createSpan({ text: action.label });

      btn.addEventListener("click", () => {
        if (this.isLoading || !this.inputEl) return;
        const noteContent = this.getActiveNoteContent();
        const noteTitle = this.getActiveNoteTitle();
        if (noteContent) {
          // Send full note content — RAG search in sendMessage() adds vault context
          this.inputEl.value = `[Note: ${noteTitle || "Untitled"}]\n${noteContent}\n\n---\n${action.prompt}`;
        } else {
          this.inputEl.value = action.prompt;
          new Notice("No active note found — sending prompt without context");
        }
        this.sendMessage();
      });
    }
  }

  /**
   * Get the content of the currently active note (the one visible in the editor)
   */
  private getActiveNoteContent(): string | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.file) return null;

    const editor = activeView.editor;
    return editor.getValue();
  }

  /**
   * Get the title of the currently active note
   */
  private getActiveNoteTitle(): string | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.file) return null;
    return activeView.file.basename;
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
      this.sendBtn.style.display = this.isLoading ? "none" : "block";
      this.sendBtn.disabled = this.isLoading;
    }
    if (this.cancelBtn) {
      this.cancelBtn.style.display = this.isLoading ? "block" : "none";
    }
    if (this.inputEl) {
      this.inputEl.disabled = this.isLoading;
    }
  }

  /**
   * Read the system prompt from the configured file
   */
  private async getSystemPrompt(): Promise<string> {
    const filePath = this.plugin.settings.systemPromptFile;

    // If a custom system prompt file is set, use it
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
    const budgets: Record<LLMProvider, number> = {
      claude: 50000,     // 200k token context
      opencode: 50000,   // Depends on model, but most are large
      gemini: 30000,     // 1M+ context, generous budget
      codex: 30000,      // Large context models
      local: 4000,       // Often 4-8k context, be conservative
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

    // Active note context
    const noteTitle = this.getActiveNoteTitle();
    if (noteTitle) {
      parts.push(`The user currently has the note "${noteTitle}" open.`);
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
   * Eagerly connect to ACP if enabled for the current provider.
   * This is called when the view opens and when the provider changes.
   * Blocks user input while connecting.
   * Tracks in-flight connections to prevent overlapping connect/disconnect calls.
   */
  /**
   * Try to start a local LLM server if one is installed but not running.
   * Probes known software (Ollama, LM Studio) and starts the first installed one.
   */
  private async tryStartLocalServer(onProgress: (e: StreamChunk) => void): Promise<boolean> {
    const { detectLocalSoftwareStatuses, startLocalServer } = await import("../utils/autoDetect");
    onProgress({ type: "status", message: "Local server not running — checking installed software..." });

    try {
      const statuses = await detectLocalSoftwareStatuses();
      const startable = statuses.find((s) => s.installed && !s.serverRunning && s.canAutoStart);
      if (!startable) {
        onProgress({ type: "status", message: "No local LLM server can be auto-started." });
        return false;
      }

      onProgress({ type: "status", message: `Starting ${startable.name}...` });
      new Notice(`Starting ${startable.name}...`);
      const result = await startLocalServer(startable.name);

      if (!result.ok) {
        onProgress({ type: "status", message: `Failed to start ${startable.name}: ${result.error}` });
        new Notice(`Failed to start ${startable.name}: ${result.error}`);
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

      onProgress({ type: "status", message: `${startable.name} started — retrying...` });
      new Notice(`${startable.name} started`);
      return true;
    } catch (err) {
      onProgress({ type: "status", message: `Auto-start failed: ${err instanceof Error ? err.message : String(err)}` });
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
    this.handleProgressEvent({ type: "status", message: `Connecting to ${targetProvider} ACP...` });

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
      console.error("ACP connection failed:", errorMsg);

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
      timestamp: Date.now(),
      provider: this.currentProvider,
    };
    this.messages.push(userMessage);
    await this.renderMessagesContent();

    // Show loading state
    this.setLoading(true);

    // Build conversation context
    const contextPrompt = await this.buildContextPrompt(prompt);

    try {
      // Stream callback for real-time text updates
      let streamedContent = "";
      const onStream = (chunk: string) => {
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
      // OpenCode ACP uses HTTP transport, not stdio — force CLI mode regardless of stored setting
      if (this.currentProvider === "opencode" && providerConfig.useAcp) {
        providerConfig.useAcp = false;
      }
      const useAcp = providerConfig.useAcp && ACP_SUPPORTED_PROVIDERS.includes(this.currentProvider);

      let response: { content: string; provider: LLMProvider; durationMs: number; error?: string };

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
          onProgress({ type: "status", message: `Connecting to ${this.currentProvider} ACP...` });
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

        const acpResponse = await this.acpExecutor.prompt(contextPrompt, { onProgress });

        // Use ACP accumulated content (streamedContent won't be set for ACP mode)
        const content = acpResponse.content;

        // Warn if response is unexpectedly empty
        if (!content && !acpResponse.error) {
          console.warn("ACP response has no content - this may indicate a problem");
        }

        response = {
          content,
          provider: this.currentProvider,
          durationMs: 0,
          error: acpResponse.error || (!content ? "No response received from agent" : undefined),
        };
      } else {
        // Use regular CLI executor
        response = await this.executor.execute(
          contextPrompt,
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
        this.showError(response.error);
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
        };
        this.messages.push(assistantMessage);
        await this.renderMessagesContent();
        // Auto-save after each exchange
        await this.persistSessions();
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
        this.updateProgressDisplay(event.message, "status");
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
   * Gather system context: system prompt, referenced notes, vault RAG.
   */
  private async buildSystemContext(prompt: string): Promise<string> {
    const [systemPrompt, referencedNotes, vaultContext] = await Promise.all([
      this.getSystemPrompt(),
      this.resolveNoteReferences(prompt),
      this.vaultSearch.buildContext(prompt, this.getContextBudget()),
    ]);
    const parts: string[] = [];
    if (systemPrompt) parts.push(systemPrompt);
    if (referencedNotes) parts.push(referencedNotes);
    if (vaultContext) parts.push(vaultContext);
    return parts.join("\n\n");
  }

  private async buildContextPrompt(currentPrompt: string): Promise<string> {
    const systemContext = await this.buildSystemContext(currentPrompt);

    const contextParts: string[] = [];

    if (systemContext) {
      contextParts.push(`System: ${systemContext}`);
    }

    // Add conversation history if enabled
    if (
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

  private async updateStreamingMessage(content: string) {
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

      const headerEl = streamingEl.createDiv({ cls: "llm-message-header" });
      headerEl.createSpan({
        text: PROVIDER_DISPLAY_NAMES[this.currentProvider],
        cls: "llm-message-role",
      });
      headerEl.createSpan({ text: "...", cls: "llm-message-time" });

      streamingEl.createDiv({ cls: "llm-message-content" });
    }

    const contentEl = streamingEl.querySelector(".llm-message-content") as HTMLElement;
    if (contentEl) {
      // Clear and render markdown
      contentEl.empty();
      const activeFile = this.app.workspace.getActiveFile();
      const sourcePath = activeFile?.path ?? "";

      // Use a temporary component for streaming renders
      const component = new Component();
      component.load();
      await MarkdownRenderer.render(
        this.app,
        content,
        contentEl,
        sourcePath,
        component
      );
      // Don't track this component - it gets replaced on each update
      component.unload();
    }

    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private removeStreamingMessage() {
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
        (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.open();
        (this.app as unknown as { setting: { openTabById: (id: string) => void } }).setting.openTabById("obsidian-llm");
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
    } else if (this.isLoading) {
      new Notice(`Clicked: ${buttonText}`);
    }
  }

  /**
   * Send a message to the LLM about a checkbox change
   */
  private notifyCheckboxChange(itemText: string, isChecked: boolean) {
    const action = isChecked ? "checked" : "unchecked";
    const message = `[${action}: "${itemText}"]`;

    // Set the input and send
    if (this.inputEl && !this.isLoading) {
      this.inputEl.value = message;
      this.sendMessage();
    } else if (this.isLoading) {
      new Notice(`${action}: ${itemText}`);
    }
  }

  /**
   * Create a new note from an LLM response
   */
  private async createNoteFromMessage(msg: ConversationMessage) {
    // Generate a title from the first line or first few words
    const firstLine = msg.content.split("\n")[0];
    let title = firstLine
      .replace(/^#+\s*/, "") // Remove markdown headers
      .replace(/[\\/*?"<>|:]/g, "") // Remove invalid filename chars
      .trim();

    if (title.length > 50) {
      title = title.slice(0, 47) + "...";
    }
    if (!title) {
      title = `LLM Response ${new Date(msg.timestamp).toLocaleDateString()}`;
    }

    // Find a unique filename
    let fileName = `${title}.md`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(fileName)) {
      fileName = `${title} ${counter}.md`;
      counter++;
    }

    try {
      const file = await this.app.vault.create(fileName, msg.content);
      new Notice(`Created note: ${file.path}`);

      // Open the new file
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (error) {
      new Notice(`Failed to create note: ${error}`);
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
