import { Editor, MarkdownView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { LLMPluginSettings, LLMProvider, ProviderConfig } from "./src/types";
import { DEFAULT_SETTINGS } from "./src/types";
import { LLMSettingTab } from "./src/settings/SettingsTab";
import { QuickPromptModal } from "./src/modals";
import { ChatView, CHAT_VIEW_TYPE } from "./src/views";
import { LLMExecutor } from "./src/executor/LLMExecutor";
import { autoDetectProviders, applyDetectionResults } from "./src/utils/autoDetect";

export interface ChatSession {
  id: string;
  name: string;
  messages: { role: "user" | "assistant"; content: string; timestamp: number; provider: string }[];
}

export default class LLMPlugin extends Plugin {
  settings: LLMPluginSettings;
  private executor: LLMExecutor | null = null;
  private statusBarEl: HTMLElement | null = null;
  private chatSessions: ChatSession[] = [];

  async onload() {
    await this.loadSettings();

    // Auto-detect providers in the background (don't block startup)
    this.autoDetect();

    // Initialize executor
    this.executor = new LLMExecutor(this.settings);

    // Register the chat view
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon for quick chat
    this.addRibbonIcon("message-square", "Open LLM Chat", () => {
      this.activateChatView();
    });

    // Add status bar item
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("llm-status-bar-item");
    this.updateStatusBar();

    // Command: Open LLM Chat
    this.addCommand({
      id: "open-llm-chat",
      name: "Open Chat",
      callback: () => {
        this.activateChatView();
      },
    });

    // Command: Quick Prompt
    this.addCommand({
      id: "quick-llm-prompt",
      name: "Quick Prompt",
      callback: () => {
        new QuickPromptModal(this.app, this).open();
      },
    });

    // Command: Send Selection to LLM
    this.addCommand({
      id: "send-selection-to-llm",
      name: "Send Selection to LLM",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }

        new QuickPromptModal(this.app, this, {
          initialText: selection,
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Summarize Selection
    this.addCommand({
      id: "summarize-selection",
      name: "Summarize Selection",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }

        new QuickPromptModal(this.app, this, {
          initialText: selection,
          promptPrefix: "Please summarize the following text concisely:",
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Explain Selection
    this.addCommand({
      id: "explain-selection",
      name: "Explain Selection",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }

        new QuickPromptModal(this.app, this, {
          initialText: selection,
          promptPrefix: "Please explain the following in simple terms:",
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Improve Writing
    this.addCommand({
      id: "improve-writing",
      name: "Improve Writing",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }

        new QuickPromptModal(this.app, this, {
          initialText: selection,
          promptPrefix:
            "Please improve the following text for clarity and readability while preserving the meaning:",
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Generate from Context
    this.addCommand({
      id: "generate-from-context",
      name: "Generate from Current Note Context",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        const content = editor.getValue();
        const cursor = editor.getCursor();

        new QuickPromptModal(this.app, this, {
          promptPrefix: `Given the following note content, please continue writing or answer questions about it:\n\n---\n${content.slice(0, 2000)}${content.length > 2000 ? "..." : ""}\n---\n\nYour request:`,
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Detect Available Providers
    this.addCommand({
      id: "detect-providers",
      name: "Scan for AI providers",
      callback: async () => {
        new Notice("Scanning for AI providers...");
        const result = await autoDetectProviders();
        if (result.detected.length === 0) {
          new Notice("No AI providers found. Install a CLI tool (claude, codex, gemini) or start a local server (Ollama, LM Studio).");
        } else {
          const names = result.detected.map((d) => d.name).join(", ");
          const changed = applyDetectionResults(this.settings, result);
          if (changed) {
            await this.saveSettings();
            new Notice(`Found: ${names}. Settings updated automatically.`);
          } else {
            new Notice(`Found: ${names}`);
          }
        }
      },
    });

    // Add settings tab
    this.addSettingTab(new LLMSettingTab(this.app, this));
  }

  /**
   * Auto-detect available providers on startup.
   * If local software is installed with models but server not running, start it automatically.
   */
  private async autoDetect() {
    try {
      const result = await autoDetectProviders();

      // If local software has models but server isn't running → start it
      for (const sw of result.localSoftware) {
        if (sw.installed && sw.hasModels && !sw.serverRunning && sw.canAutoStart) {
          const { startLocalServer } = await import("./src/utils/autoDetect");
          const startResult = await startLocalServer(sw.name);
          if (startResult.ok) {
            // Re-probe to get the server's model list
            const { LocalLLMExecutor } = await import("./src/executor/LocalLLMExecutor");
            const conn = await LocalLLMExecutor.testConnection(sw.url, sw.type);
            if (conn.ok && conn.models && conn.models.length > 0) {
              result.detected.push({
                provider: "local",
                name: `Local LLM (${sw.name})`,
                serverName: sw.name,
                serverUrl: sw.url,
                serverType: sw.type,
                models: conn.models,
              });
            }
          }
        }
      }

      // Warn if OpenCode is installed but not authenticated
      const openCodeEntry = result.detected.find((d) => d.provider === "opencode");
      if (openCodeEntry && openCodeEntry.authOk === false) {
        new Notice(
          "OpenCode found but not authenticated. Open a terminal and run: opencode auth",
          10000
        );
      }

      if (result.detected.length > 0) {
        const changed = applyDetectionResults(this.settings, result);
        if (changed) {
          await this.saveSettings();
          const names = result.detected.map((d) => d.name).join(", ");
          new Notice(`AI providers detected: ${names}`);
        }
      }
    } catch {
      // Silent failure — auto-detect is best-effort
    }
  }

  onunload() {
    this.executor?.cancel();
    // Detach all chat view leaves
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
  }

  /**
   * Activate or reveal the chat view panel
   */
  async activateChatView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create a new leaf in the right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }

    return leaf;
  }

  /**
   * Get the ChatView instance if it exists
   */
  getChatView(): ChatView | null {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length > 0) {
      return leaves[0].view as ChatView;
    }
    return null;
  }

  /**
   * Add a message exchange to the chat view
   */
  addToChatView(userMessage: string, assistantMessage: string, provider: LLMProvider) {
    const chatView = this.getChatView();
    if (chatView) {
      chatView.addMessageExchange(userMessage, assistantMessage, provider);
    }
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {});
    // Load chat sessions (stored alongside settings)
    this.chatSessions = (loadedData as any)?._chatSessions ?? [];

    // Migration: handle old systemPrompt string setting
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldData = loadedData as any;
    if (oldData?.systemPrompt && typeof oldData.systemPrompt === "string" && oldData.systemPrompt.trim()) {
      // Old inline system prompt exists - show migration notice
      new Notice(
        "System prompt settings have changed. Please create a note with your system prompt and select it in settings.",
        10000
      );
    }

    // Migration: handle old per-provider timeout (ensure defaultTimeout exists)
    if (this.settings.defaultTimeout === undefined) {
      this.settings.defaultTimeout = 120;
    }

    // Migration: OpenCode ACP uses HTTP transport, not stdio — disable ACP for OpenCode
    if (this.settings.providers.opencode?.useAcp === true) {
      this.settings.providers.opencode.useAcp = false;
    }

    // Migration: ensure local provider config exists
    if (!this.settings.providers.local) {
      this.settings.providers.local = {
        enabled: false,
        serverUrl: "http://localhost:11434",
        serverType: "ollama",
        temperature: 0.7,
        maxTokens: 0,
      };
    }
  }

  async saveSettings() {
    const merged = await this.mergeBeforeSave();
    await this.saveData(merged);
    // Update executor with new settings
    this.executor?.updateSettings(this.settings);
    this.updateStatusBar();
  }

  getChatSessions(): ChatSession[] {
    return this.chatSessions;
  }

  async saveChatSessions(sessions: ChatSession[]) {
    this.chatSessions = sessions;
    // Skip full merge for session saves — sessions are only modified locally,
    // so a lightweight save is sufficient and avoids extra disk reads.
    await this.saveData({ ...this.settings, _chatSessions: this.chatSessions });
  }

  /**
   * Load current data.json and merge with in-memory state.
   * Preserves user decisions from cloud-synced changes while
   * incorporating local changes (new sessions, setting updates).
   */
  private async mergeBeforeSave(): Promise<Record<string, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disk = (await this.loadData()) as any ?? {};

    // Merge provider configs: for each provider, prefer local in-memory values
    // but preserve any keys that exist on disk but not in memory (user decisions
    // from another device). Never drop a provider the user enabled elsewhere.
    const mergedProviders: Record<string, ProviderConfig> = {};
    const allProviderKeys = new Set([
      ...Object.keys(this.settings.providers ?? {}),
      ...Object.keys(disk.providers ?? {}),
    ]);
    for (const key of allProviderKeys) {
      const mem = (this.settings.providers as Record<string, ProviderConfig>)[key];
      const ext = (disk.providers as Record<string, ProviderConfig> | undefined)?.[key];
      if (mem && ext) {
        // Both exist: in-memory wins per-field, but keep extra disk keys
        mergedProviders[key] = { ...ext, ...mem };
      } else {
        mergedProviders[key] = mem ?? ext;
      }
    }

    // Merge chat sessions by ID: combine both sets, preferring the version
    // with the most messages (= most recent activity)
    const diskSessions: ChatSession[] = disk._chatSessions ?? [];
    const memSessions = this.chatSessions;
    const sessionMap = new Map<string, ChatSession>();
    for (const s of diskSessions) {
      sessionMap.set(s.id, s);
    }
    for (const s of memSessions) {
      const existing = sessionMap.get(s.id);
      if (!existing || s.messages.length >= existing.messages.length) {
        sessionMap.set(s.id, s);
      }
    }
    const mergedSessions = Array.from(sessionMap.values());
    this.chatSessions = mergedSessions;

    // Build final object: disk as base, then in-memory settings, then merged parts
    return {
      ...disk,
      ...this.settings,
      providers: mergedProviders,
      _chatSessions: mergedSessions,
    };
  }

  /**
   * Insert LLM response into the editor based on settings
   */
  private insertResponse(editor: Editor, response: string) {
    const position = this.settings.insertPosition;

    switch (position) {
      case "cursor":
        editor.replaceRange(response, editor.getCursor());
        break;

      case "end":
        const lastLine = editor.lastLine();
        const lastLineContent = editor.getLine(lastLine);
        editor.replaceRange(
          "\n\n" + response,
          { line: lastLine, ch: lastLineContent.length }
        );
        break;

      case "replace-selection":
        editor.replaceSelection(response);
        break;
    }

    new Notice("LLM response inserted");
  }

  /**
   * Update the status bar with current provider and model info
   * @param provider Optional provider to display (uses default if not specified)
   * @param actualModelName Optional actual model name from ACP session (overrides configured model display)
   * @param status Optional status: "idle" (default), "connecting", "connected"
   */
  updateStatusBar(provider?: LLMProvider, actualModelName?: string, status?: "idle" | "connecting" | "connected") {
    if (!this.statusBarEl) return;

    const displayProvider = provider ?? this.settings.defaultProvider;
    const providerConfig = this.settings.providers[displayProvider];
    const providerNames: Record<string, string> = {
      claude: "Claude",
      opencode: "OpenCode",
      codex: "Codex",
      gemini: "Gemini",
    };

    this.statusBarEl.empty();
    this.statusBarEl.addClass("llm-status-bar");

    const indicator = this.statusBarEl.createSpan({ cls: "llm-status-indicator" });

    // Build status text with provider and model
    let statusText = providerNames[displayProvider] || displayProvider;
    if (status === "connecting") {
      statusText += " (connecting...)";
    } else if (actualModelName) {
      // Use actual model name from ACP session
      statusText += ` (${this.formatModelName(actualModelName)})`;
    } else if (providerConfig?.model) {
      // Show configured model name
      statusText += ` (${this.formatModelName(providerConfig.model)})`;
    } else {
      // Indicate CLI default is being used
      statusText += " (default)";
    }

    this.statusBarEl.createSpan({
      text: ` LLM: ${statusText}`,
      cls: "llm-status-text",
    });

    // Set indicator state based on status
    if (status === "connecting") {
      indicator.addClass("connecting");
    } else if (providerConfig?.enabled) {
      indicator.addClass("active");
    }
  }

  /**
   * Format model name for display (abbreviate long names)
   */
  private formatModelName(model: string): string {
    // Common abbreviations for model IDs
    const abbreviations: Record<string, string> = {
      "claude-3-5-haiku-latest": "haiku",
      "claude-3-5-sonnet-latest": "sonnet-3.5",
      "claude-sonnet-4-20250514": "sonnet-4",
      "claude-opus-4-20250514": "opus-4",
      "gemini-3.0-flash": "flash-3.0",
      "gemini-2.0-flash-lite": "flash-lite",
      "gemini-2.0-flash": "flash-2.0",
      "gemini-2.5-flash": "flash-2.5",
      "gemini-2.5-pro": "pro-2.5",
      "gpt-4o-mini": "4o-mini",
      "gpt-4o": "4o",
      "gpt-5-nano": "5-nano",
      "gpt-5-mini": "5-mini",
      "gpt-5": "5",
      "claude-sonnet": "sonnet",
      "claude-haiku": "haiku",
      // ACP display names (from Claude ACP adapter)
      "default": "opus",
      "Default (recommended)": "opus",
      "Sonnet": "sonnet",
      "Haiku": "haiku",
    };

    // Check for exact match first
    if (abbreviations[model]) {
      return abbreviations[model];
    }

    // Try case-insensitive match
    const lowerModel = model.toLowerCase();
    for (const [key, value] of Object.entries(abbreviations)) {
      if (key.toLowerCase() === lowerModel) {
        return value;
      }
    }

    // If model name is long, try to extract a shorter name
    // Remove text in parentheses and trim
    const simplified = model.replace(/\s*\([^)]*\)\s*/g, "").trim();
    if (simplified !== model && simplified.length > 0) {
      return this.formatModelName(simplified);
    }

    return model;
  }
}
