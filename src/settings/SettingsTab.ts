import { App, DropdownComponent, FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFile } from "obsidian";
import type LLMPlugin from "../../main";
import type { LLMProvider, LocalServerType } from "../types";
import { PROVIDER_MODELS, ACP_SUPPORTED_PROVIDERS } from "../types";
import { fetchModelsForProvider, type ModelOption } from "../utils/modelFetcher";
import { LocalLLMExecutor } from "../executor/LocalLLMExecutor";
import {
  autoDetectProviders,
  applyDetectionResults,
  startLocalServer,
  pullModel,
  type LocalSoftwareStatus,
} from "../utils/autoDetect";

/**
 * Modal for selecting a markdown file from the vault
 */
class SystemPromptFileSuggestModal extends FuzzySuggestModal<TFile> {
  private onSelect: (file: TFile) => void;

  constructor(app: App, onSelect: (file: TFile) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder("Select a markdown file for the system prompt...");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}

const PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
  claude: "Claude (Anthropic)",
  opencode: "OpenCode",
  codex: "Codex (OpenAI)",
  gemini: "Gemini (Google)",
  local: "Local LLM",
};

const PROVIDER_DESCRIPTIONS: Record<LLMProvider, string> = {
  claude: "Anthropic's Claude models — requires the Claude CLI",
  opencode: "Multi-provider CLI supporting Claude, GPT, and more",
  codex: "OpenAI's Codex CLI — requires an OpenAI API key",
  gemini: "Google's Gemini models — requires the Gemini CLI",
  local: "Run models on your own machine with Ollama, LM Studio, or similar",
};

export class LLMSettingTab extends PluginSettingTab {
  plugin: LLMPlugin;
  private expertMode = false;

  constructor(app: App, plugin: LLMPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("llm-settings");

    // ── Header with expert mode toggle ──
    const header = containerEl.createDiv({ cls: "llm-settings-header" });
    header.createEl("h2", { text: "AI Chat" });

    const expertToggle = header.createEl("button", {
      cls: `llm-expert-toggle ${this.expertMode ? "llm-expert-toggle-on" : ""}`,
      text: this.expertMode ? "Expert mode" : "Simple mode",
      attr: { "aria-label": "Toggle expert mode" },
    });
    expertToggle.addEventListener("click", () => {
      this.expertMode = !this.expertMode;
      this.display();
    });

    // ── Providers (always visible — the core feature) ──
    this.addProvidersSection(containerEl);

    // ── Expert: General + Conversation + Advanced ──
    if (this.expertMode) {
      this.addGeneralSettings(containerEl);
      this.addConversationSettings(containerEl);
      this.addAdvancedSettings(containerEl);
    }
  }

  // ════════════════════════════════════════════
  //  General Settings
  // ════════════════════════════════════════════
  /**
   * Renders a pure-div toggle (no native checkbox) to avoid Obsidian's global checkbox styles.
   * Returns the track element so callers can update its state if needed.
   */
  private createProviderToggle(
    container: HTMLElement,
    initialValue: boolean,
    onChange: (value: boolean) => Promise<void>
  ): HTMLElement {
    const track = container.createDiv({
      cls: `llm-toggle-track ${initialValue ? "llm-toggle-on" : ""}`,
      attr: { role: "switch", "aria-checked": String(initialValue), tabindex: "0" },
    });
    track.createDiv({ cls: "llm-toggle-thumb" });

    const toggle = (e: Event) => {
      e.stopPropagation();
      const on = !track.hasClass("llm-toggle-on");
      track.toggleClass("llm-toggle-on", on);
      track.setAttribute("aria-checked", String(on));
      onChange(on);
    };
    track.addEventListener("click", toggle);
    track.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(e); }
    });
    return track;
  }

  private addGeneralSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "General" });

    // Default provider
    new Setting(containerEl)
      .setName("Default AI provider")
      .setDesc("Which AI to use when you open a new chat (only enabled providers shown)")
      .addDropdown((dropdown) => {
        const allProviders: LLMProvider[] = ["claude", "opencode", "codex", "gemini", "local"];
        const enabledProviders = allProviders.filter((p) => this.plugin.settings.providers[p]?.enabled);
        // Show enabled providers, or all if none enabled (so user can pick one)
        const toShow = enabledProviders.length > 0 ? enabledProviders : allProviders;
        toShow.forEach((provider) => {
          dropdown.addOption(provider, PROVIDER_DISPLAY_NAMES[provider]);
        });
        // If current default is not enabled, switch to first enabled
        if (enabledProviders.length > 0 && !enabledProviders.includes(this.plugin.settings.defaultProvider)) {
          this.plugin.settings.defaultProvider = enabledProviders[0];
        }
        dropdown.setValue(this.plugin.settings.defaultProvider);
        dropdown.onChange(async (value) => {
          this.plugin.settings.defaultProvider = value as LLMProvider;
          await this.plugin.saveSettings();
        });
      });

    // Insert position
    new Setting(containerEl)
      .setName("Insert responses")
      .setDesc("Where to place AI responses when using quick commands on selected text")
      .addDropdown((dropdown) => {
        dropdown.addOption("cursor", "At cursor");
        dropdown.addOption("end", "End of note");
        dropdown.addOption("replace-selection", "Replace selection");
        dropdown.setValue(this.plugin.settings.insertPosition);
        dropdown.onChange(async (value) => {
          this.plugin.settings.insertPosition = value as "cursor" | "end" | "replace-selection";
          await this.plugin.saveSettings();
        });
      });

    // Stream output
    new Setting(containerEl)
      .setName("Live streaming")
      .setDesc("Show the AI's response word-by-word as it's being generated")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.streamOutput);
        toggle.onChange(async (value) => {
          this.plugin.settings.streamOutput = value;
          await this.plugin.saveSettings();
        });
      });

    // System prompt
    const systemPromptSetting = new Setting(containerEl)
      .setName("Custom instructions")
      .setDesc("Pick a note from your vault to use as instructions for the AI (optional)");

    const systemPromptInput = systemPromptSetting.controlEl.createEl("input", {
      type: "text",
      cls: "llm-file-input",
      attr: {
        placeholder: "None selected",
        readonly: "true",
      },
    });
    systemPromptInput.value = this.plugin.settings.systemPromptFile || "";

    const browseBtn = systemPromptSetting.controlEl.createEl("button", {
      text: "Browse",
      cls: "llm-browse-btn",
    });
    browseBtn.addEventListener("click", () => {
      new SystemPromptFileSuggestModal(this.app, async (file) => {
        this.plugin.settings.systemPromptFile = file.path;
        systemPromptInput.value = file.path;
        await this.plugin.saveSettings();
      }).open();
    });

    const clearBtn = systemPromptSetting.controlEl.createEl("button", {
      text: "Clear",
      cls: "llm-clear-btn",
    });
    clearBtn.addEventListener("click", async () => {
      this.plugin.settings.systemPromptFile = "";
      systemPromptInput.value = "";
      await this.plugin.saveSettings();
    });
  }

  // ════════════════════════════════════════════
  //  Conversation Settings
  // ════════════════════════════════════════════
  private addConversationSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Conversation" });

    new Setting(containerEl)
      .setName("Remember conversation")
      .setDesc("The AI remembers previous messages so you can have a back-and-forth conversation")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.conversationHistory.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.conversationHistory.enabled = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Memory length")
      .setDesc("How many previous messages the AI can see (more = better context, but uses more tokens)")
      .addSlider((slider) => {
        slider.setLimits(1, 50, 1);
        slider.setValue(this.plugin.settings.conversationHistory.maxMessages);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.conversationHistory.maxMessages = value;
          await this.plugin.saveSettings();
        });
      });
  }

  // ════════════════════════════════════════════
  //  Providers Section
  // ════════════════════════════════════════════
  private addProvidersSection(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "AI Providers" });

    // Auto-detect button
    const scanSetting = new Setting(containerEl)
      .setName("Auto-detect providers")
      .setDesc("Scan your system for installed CLI tools and local AI servers");

    // Container for setup cards (inserted after scan button)
    const setupContainer = containerEl.createDiv({ cls: "llm-setup-container" });

    scanSetting.addButton((btn) => {
      btn.setButtonText("Scan now");
      btn.setCta();
      btn.onClick(async () => {
        btn.setButtonText("Scanning...");
        btn.setDisabled(true);
        setupContainer.empty();

        try {
          const result = await autoDetectProviders();

          // Show setup cards for installed-but-not-ready software
          const needsSetup = result.localSoftware.filter(
            (s) => s.installed && (!s.serverRunning || !s.hasModels)
          );

          if (needsSetup.length > 0) {
            for (const sw of needsSetup) {
              this.addSetupCard(setupContainer, sw);
            }
          }

          if (result.detected.length > 0) {
            const changed = applyDetectionResults(this.plugin.settings, result);
            const names = result.detected.map((d) => d.name).join(", ");
            if (changed) {
              await this.plugin.saveSettings();
              new Notice(`Found: ${names}. Settings updated.`);
            } else {
              new Notice(`Found: ${names}`);
            }
            this.display();
            return;
          } else if (needsSetup.length > 0) {
            new Notice("Software found but needs setup — see cards below.");
          } else {
            new Notice("No AI providers found. Install a CLI tool or a local AI server like Ollama.");
          }
        } catch {
          new Notice("Scan failed. Please try again.");
        }
        btn.setButtonText("Scan now");
        btn.setDisabled(false);
      });
    });

    const providers: LLMProvider[] = ["claude", "opencode", "codex", "gemini", "local"];
    providers.forEach((provider) => {
      if (provider === "local") {
        this.addLocalProviderSettings(containerEl);
      } else {
        this.addCloudProviderSettings(containerEl, provider);
      }
    });
  }

  /**
   * Setup card for installed software that needs server start or model download.
   * Priority: 1) Use existing models  2) Start server  3) Download only as last resort
   */
  private addSetupCard(container: HTMLElement, sw: LocalSoftwareStatus): void {
    const card = container.createDiv({ cls: "llm-setup-card" });
    card.createEl("strong", { text: sw.name });

    const statusEl = card.createDiv({ cls: "llm-setup-status" });
    const actionsEl = card.createDiv({ cls: "llm-setup-actions" });

    // Case 1: Server not running, but has local models → just start the server
    if (!sw.serverRunning && sw.hasModels && sw.canAutoStart) {
      statusEl.createSpan({
        text: `Installed with ${sw.models.length} model${sw.models.length > 1 ? "s" : ""} — server not running`,
        cls: "llm-setup-warning",
      });

      this.addStartServerButton(actionsEl, sw);
      return;
    }

    // Case 2: Server not running, no models detected via CLI → start server first, then check
    if (!sw.serverRunning && !sw.hasModels && sw.canAutoStart) {
      statusEl.createSpan({ text: "Installed but not running", cls: "llm-setup-warning" });

      this.addStartServerButton(actionsEl, sw);
      return;
    }

    // Case 3: Server running but no models
    if (sw.serverRunning && !sw.hasModels) {
      statusEl.createSpan({
        text: "Server is running but has no models",
        cls: "llm-setup-warning",
      });

      if (sw.canPullModels && sw.defaultModel) {
        this.showModelPull(actionsEl, sw);
      }
    }
  }

  /**
   * Button to start a local server. After starting, auto-configures with existing models.
   * Only offers model download if truly no models exist.
   */
  private addStartServerButton(container: HTMLElement, sw: LocalSoftwareStatus): void {
    const startBtn = container.createEl("button", {
      text: `Start ${sw.name}`,
      cls: "llm-setup-btn llm-setup-btn-accent",
    });

    startBtn.addEventListener("click", async () => {
      startBtn.textContent = "Starting...";
      startBtn.setAttribute("disabled", "true");

      const result = await startLocalServer(sw.name);
      if (!result.ok) {
        startBtn.textContent = `Failed: ${result.error || "unknown error"}`;
        startBtn.addClass("llm-setup-error");
        return;
      }

      startBtn.textContent = "Running!";
      startBtn.addClass("llm-setup-success");

      // Check what models are available now
      try {
        const conn = await LocalLLMExecutor.testConnection(sw.url, sw.type);
        if (conn.ok && conn.models && conn.models.length > 0) {
          // Has models → use the first one, done!
          this.configureLocalProvider(sw, conn.models[0]);
          new Notice(`${sw.name} ready — using ${conn.models[0]}`);
          this.display();
          return;
        }
      } catch { /* no models available */ }

      // Server running but truly no models — offer download
      if (sw.canPullModels && sw.defaultModel) {
        this.showModelPull(container, sw);
      }
    });
  }

  /**
   * Show model download UI. Only shown when server has zero models.
   * Recommends Qwen 3 as default.
   */
  private showModelPull(container: HTMLElement, sw: LocalSoftwareStatus): void {
    const pullContainer = container.createDiv({ cls: "llm-setup-pull" });
    pullContainer.createSpan({
      text: `No models on this server yet. We recommend Qwen 3 (${sw.defaultModel}) — fast, multilingual, and runs well on most hardware.`,
    });

    const progressEl = pullContainer.createDiv({ cls: "llm-setup-progress" });

    const pullBtn = pullContainer.createEl("button", {
      text: `Download ${sw.defaultModel}`,
      cls: "llm-setup-btn llm-setup-btn-accent",
    });

    pullBtn.addEventListener("click", async () => {
      pullBtn.textContent = "Downloading...";
      pullBtn.setAttribute("disabled", "true");
      progressEl.textContent = "Starting download...";

      const result = await pullModel(sw.name, sw.defaultModel!, (line) => {
        progressEl.textContent = line;
      });

      if (result.ok) {
        progressEl.textContent = "Download complete!";
        progressEl.addClass("llm-setup-success");

        this.configureLocalProvider(sw, sw.defaultModel!);
        new Notice(`${sw.name} is ready with ${sw.defaultModel}!`);
        this.display();
      } else {
        progressEl.textContent = `Download failed: ${result.error}`;
        progressEl.addClass("llm-setup-error");
        pullBtn.textContent = "Retry";
        pullBtn.removeAttribute("disabled");
      }
    });
  }

  /**
   * Configure the local provider with a detected server + model
   */
  private async configureLocalProvider(sw: LocalSoftwareStatus, model: string): Promise<void> {
    this.plugin.settings.providers.local.enabled = true;
    this.plugin.settings.providers.local.serverUrl = sw.url;
    this.plugin.settings.providers.local.serverType = sw.type;
    this.plugin.settings.providers.local.model = model;
    this.plugin.settings.defaultProvider = "local";
    await this.plugin.saveSettings();
  }

  // ════════════════════════════════════════════
  //  Cloud Provider Settings (simplified)
  // ════════════════════════════════════════════
  private addCloudProviderSettings(containerEl: HTMLElement, provider: Exclude<LLMProvider, "local">): void {
    const providerConfig = this.plugin.settings.providers[provider];
    const displayName = PROVIDER_DISPLAY_NAMES[provider];

    const card = containerEl.createDiv({
      cls: `llm-provider-card ${providerConfig.enabled ? "llm-provider-card-enabled" : ""}`,
    });

    // ── Card header: name + description + toggle ──
    const cardHeader = card.createDiv({ cls: "llm-provider-card-header" });
    const cardInfo = cardHeader.createDiv({ cls: "llm-provider-card-info" });
    cardInfo.createDiv({ text: displayName, cls: "llm-provider-card-name" });
    cardInfo.createDiv({ text: PROVIDER_DESCRIPTIONS[provider], cls: "llm-provider-card-desc" });

    // Enable toggle — right side of header
    this.createProviderToggle(cardHeader, providerConfig.enabled, async (val) => {
      this.plugin.settings.providers[provider].enabled = val;
      card.toggleClass("llm-provider-card-enabled", val);
      await this.plugin.saveSettings();
    });

    // ── Expandable settings (only in expert mode, or when enabled) ──
    const detailsEl = card.createEl("details", { cls: "llm-provider-details" });
    const summaryEl = detailsEl.createEl("summary", { cls: "llm-provider-details-summary" });
    summaryEl.setText(this.expertMode ? "Settings" : "Configure");
    const settingsContainer = detailsEl.createDiv({ cls: "llm-provider-settings" });

    // Model selection
    this.addModelSetting(settingsContainer, provider, providerConfig.model ?? "");

    // Gemini-specific: Yolo mode (user-friendly name)
    if (provider === "gemini") {
      new Setting(settingsContainer)
        .setName("Auto-confirm actions")
        .setDesc("Allow Gemini to run commands without asking for permission each time")
        .addToggle((toggle) => {
          toggle.setValue(providerConfig.yoloMode ?? false);
          toggle.onChange(async (value) => {
            this.plugin.settings.providers[provider].yoloMode = value;
            await this.plugin.saveSettings();
          });
        });
    }

    // ── Advanced options (collapsed) ──
    const advancedDetails = settingsContainer.createEl("details", {
      cls: "llm-advanced-toggle",
    });
    advancedDetails.createEl("summary", { text: "Advanced options" });
    const advancedContainer = advancedDetails.createDiv({ cls: "llm-advanced-settings" });

    // Persistent connection (ACP) — for supported providers
    if (ACP_SUPPORTED_PROVIDERS.includes(provider)) {
      // Thinking mode (only visible when persistent connection is on)
      const thinkingModeSetting = new Setting(advancedContainer)
        .setName("Thinking depth")
        .setDesc("How deeply the AI reasons before answering (none, low, medium, high)")
        .addDropdown((dropdown) => {
          dropdown.addOption("", "Default");
          dropdown.addOption("none", "None — fastest");
          dropdown.addOption("low", "Low");
          dropdown.addOption("medium", "Medium");
          dropdown.addOption("high", "High — most thorough");
          dropdown.setValue(providerConfig.thinkingMode ?? "");
          dropdown.onChange(async (value) => {
            this.plugin.settings.providers[provider].thinkingMode = value.trim() || undefined;
            await this.plugin.saveSettings();
          });
        });

      thinkingModeSetting.settingEl.style.display = providerConfig.useAcp ? "" : "none";

      const acpSetting = new Setting(advancedContainer)
        .setName("Persistent connection")
        .setDesc("Keep a live connection for faster follow-up messages (recommended)")
        .addToggle((toggle) => {
          toggle.setValue(providerConfig.useAcp ?? false);
          toggle.onChange(async (value) => {
            this.plugin.settings.providers[provider].useAcp = value;
            await this.plugin.saveSettings();
            thinkingModeSetting.settingEl.style.display = value ? "" : "none";
          });
        });

      advancedContainer.insertBefore(acpSetting.settingEl, thinkingModeSetting.settingEl);
    }

    // Custom command
    new Setting(advancedContainer)
      .setName("Custom CLI command")
      .setDesc(`Override the CLI binary (default: "${this.getDefaultCommand(provider)}")`)
      .addText((text) => {
        text.setPlaceholder(this.getDefaultCommand(provider));
        text.setValue(providerConfig.customCommand ?? "");
        text.onChange(async (value) => {
          this.plugin.settings.providers[provider].customCommand = value || undefined;
          await this.plugin.saveSettings();
        });
      });

    // Timeout
    new Setting(advancedContainer)
      .setName("Timeout")
      .setDesc(`Seconds before a request is cancelled (default: ${this.plugin.settings.defaultTimeout}s)`)
      .addSlider((slider) => {
        slider.setLimits(10, 600, 10);
        slider.setValue(providerConfig.timeout ?? this.plugin.settings.defaultTimeout);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.providers[provider].timeout = value;
          await this.plugin.saveSettings();
        });
      });
  }

  // ════════════════════════════════════════════
  //  Local LLM Settings
  // ════════════════════════════════════════════
  private addLocalProviderSettings(containerEl: HTMLElement): void {
    const providerConfig = this.plugin.settings.providers.local;

    const card = containerEl.createDiv({
      cls: `llm-provider-card ${providerConfig.enabled ? "llm-provider-card-enabled" : ""}`,
    });

    // ── Card header ──
    const cardHeader = card.createDiv({ cls: "llm-provider-card-header" });
    const cardInfo = cardHeader.createDiv({ cls: "llm-provider-card-info" });
    cardInfo.createDiv({ text: "Local LLM", cls: "llm-provider-card-name" });
    cardInfo.createDiv({ text: PROVIDER_DESCRIPTIONS.local, cls: "llm-provider-card-desc" });

    this.createProviderToggle(cardHeader, providerConfig.enabled, async (val) => {
      this.plugin.settings.providers.local.enabled = val;
      card.toggleClass("llm-provider-card-enabled", val);
      await this.plugin.saveSettings();
    });

    const detailsEl = card.createEl("details", { cls: "llm-provider-details" });
    const summaryEl = detailsEl.createEl("summary", { cls: "llm-provider-details-summary" });
    summaryEl.setText("Configure");
    const settingsContainer = detailsEl.createDiv({ cls: "llm-provider-settings" });

    // Server type
    new Setting(settingsContainer)
      .setName("Server software")
      .setDesc("What's running your local models?")
      .addDropdown((dropdown) => {
        dropdown.addOption("ollama", "Ollama");
        dropdown.addOption("openai-compatible", "LM Studio / vLLM / other");
        dropdown.setValue(providerConfig.serverType || "ollama");
        dropdown.onChange(async (value) => {
          this.plugin.settings.providers.local.serverType = value as LocalServerType;
          if (value === "ollama" && (!providerConfig.serverUrl || providerConfig.serverUrl === "http://127.0.0.1:1234")) {
            this.plugin.settings.providers.local.serverUrl = "http://127.0.0.1:11434";
            serverUrlInput.value = "http://127.0.0.1:11434";
          } else if (value === "openai-compatible" && (!providerConfig.serverUrl || providerConfig.serverUrl === "http://127.0.0.1:11434")) {
            this.plugin.settings.providers.local.serverUrl = "http://127.0.0.1:1234";
            serverUrlInput.value = "http://127.0.0.1:1234";
          }
          await this.plugin.saveSettings();
        });
      });

    // Server URL
    const serverUrlSetting = new Setting(settingsContainer)
      .setName("Server address")
      .setDesc("URL where your local server is running");

    const serverUrlInput = serverUrlSetting.controlEl.createEl("input", {
      type: "text",
      cls: "llm-file-input",
      attr: { placeholder: "http://127.0.0.1:11434" },
    });
    serverUrlInput.value = providerConfig.serverUrl || "http://127.0.0.1:11434";
    serverUrlInput.addEventListener("change", async () => {
      this.plugin.settings.providers.local.serverUrl = serverUrlInput.value.trim();
      await this.plugin.saveSettings();
    });

    // Connection test
    const testSetting = new Setting(settingsContainer)
      .setName("Connection")
      .setDesc("Check if your server is reachable and find available models");

    const resultEl = testSetting.controlEl.createEl("span", {
      cls: "llm-connection-result",
    });

    let modelDropdown: DropdownComponent | null = null;

    testSetting.addButton((btn) => {
      btn.setButtonText("Test connection");
      btn.setCta();
      btn.onClick(async () => {
        resultEl.textContent = "Connecting...";
        resultEl.className = "llm-connection-result";

        const url = this.plugin.settings.providers.local.serverUrl || "http://127.0.0.1:11434";
        const type = this.plugin.settings.providers.local.serverType || "ollama";

        const result = await LocalLLMExecutor.testConnection(url, type);

        if (result.ok) {
          resultEl.textContent = `Connected — ${result.models?.length || 0} models found`;
          resultEl.className = "llm-connection-result llm-connection-success";
          if (modelDropdown) {
            await this.refreshLocalModels(modelDropdown);
          }
        } else {
          // Server not reachable — try to auto-start it
          resultEl.textContent = "Server not running — trying to start...";
          resultEl.className = "llm-connection-result";

          const started = await this.tryAutoStartLocalServer(url, type);
          if (started) {
            resultEl.textContent = `Server started — checking models...`;
            const retry = await LocalLLMExecutor.testConnection(url, type);
            if (retry.ok) {
              resultEl.textContent = `Connected — ${retry.models?.length || 0} models found`;
              resultEl.className = "llm-connection-result llm-connection-success";
              if (modelDropdown) {
                await this.refreshLocalModels(modelDropdown);
              }
            } else {
              resultEl.textContent = "Server started but connection still failing";
              resultEl.className = "llm-connection-result llm-connection-error";
            }
          } else {
            resultEl.textContent = `Cannot reach ${url} — is the server running?`;
            resultEl.className = "llm-connection-result llm-connection-error";
          }
        }
      });
    });

    // Model
    const modelSetting = new Setting(settingsContainer)
      .setName("Model")
      .setDesc("Choose a model from your server (test connection first to see available models)");

    modelSetting.addDropdown((dd) => {
      modelDropdown = dd;
      dd.addOption("", "Select a model...");
      this.refreshLocalModels(dd);

      if (providerConfig.model) {
        dd.addOption(providerConfig.model, providerConfig.model);
        dd.setValue(providerConfig.model);
      }

      dd.onChange(async (value) => {
        this.plugin.settings.providers.local.model = value || undefined;
        await this.plugin.saveSettings();
      });
    });

    modelSetting.addButton((btn) => {
      btn.setIcon("refresh-cw");
      btn.setTooltip("Refresh model list");
      btn.onClick(async () => {
        if (modelDropdown) {
          await this.refreshLocalModels(modelDropdown);
        }
      });
    });

    // ── Advanced options for local ──
    const advancedDetails = settingsContainer.createEl("details", {
      cls: "llm-advanced-toggle",
    });
    advancedDetails.createEl("summary", { text: "Advanced options" });
    const advancedContainer = advancedDetails.createDiv({ cls: "llm-advanced-settings" });

    // Creativity (temperature) — friendly label with human-readable display
    const tempSetting = new Setting(advancedContainer)
      .setName("Creativity");

    const tempValueDisplay = tempSetting.nameEl.createSpan({ cls: "llm-setting-value" });
    const currentTemp = providerConfig.temperature ?? 0.7;
    tempValueDisplay.textContent = this.getTemperatureLabel(currentTemp);

    tempSetting
      .setDesc("How creative vs. predictable the AI's responses are")
      .addSlider((slider) => {
        slider.setLimits(0, 200, 5);
        slider.setValue(currentTemp * 100);
        slider.onChange(async (value) => {
          const temp = value / 100;
          this.plugin.settings.providers.local.temperature = temp;
          tempValueDisplay.textContent = this.getTemperatureLabel(temp);
          await this.plugin.saveSettings();
        });
      });

    // Response length (max tokens) — friendly presets
    new Setting(advancedContainer)
      .setName("Response length limit")
      .setDesc("Maximum length of the AI's reply")
      .addDropdown((dropdown) => {
        dropdown.addOption("0", "No limit (server default)");
        dropdown.addOption("512", "Short (~500 words)");
        dropdown.addOption("2048", "Medium (~2000 words)");
        dropdown.addOption("4096", "Long (~4000 words)");
        dropdown.addOption("8192", "Very long");
        dropdown.addOption("__custom__", "Custom...");

        const currentVal = providerConfig.maxTokens || 0;
        const presets = [0, 512, 2048, 4096, 8192];
        if (presets.includes(currentVal)) {
          dropdown.setValue(currentVal.toString());
        } else {
          dropdown.setValue("__custom__");
        }

        let customInput: HTMLInputElement | null = null;

        dropdown.onChange(async (value) => {
          if (value === "__custom__") {
            if (!customInput) {
              customInput = dropdown.selectEl.parentElement!.createEl("input", {
                type: "number",
                cls: "llm-timeout-input",
                attr: { placeholder: "Tokens", min: "0", max: "128000", step: "256" },
              });
              customInput.style.marginLeft = "8px";
              customInput.value = (providerConfig.maxTokens || 0).toString();
              customInput.addEventListener("change", async () => {
                const val = parseInt(customInput!.value, 10);
                this.plugin.settings.providers.local.maxTokens = isNaN(val) ? 0 : val;
                await this.plugin.saveSettings();
              });
            }
            customInput.style.display = "inline-block";
          } else {
            if (customInput) customInput.style.display = "none";
            this.plugin.settings.providers.local.maxTokens = parseInt(value, 10);
            await this.plugin.saveSettings();
          }
        });

        // Show custom input if current value is non-preset
        if (!presets.includes(currentVal)) {
          setTimeout(() => {
            customInput = dropdown.selectEl.parentElement!.createEl("input", {
              type: "number",
              cls: "llm-timeout-input",
              attr: { placeholder: "Tokens", min: "0", max: "128000", step: "256" },
            });
            customInput.style.marginLeft = "8px";
            customInput.value = currentVal.toString();
            customInput.addEventListener("change", async () => {
              const val = parseInt(customInput!.value, 10);
              this.plugin.settings.providers.local.maxTokens = isNaN(val) ? 0 : val;
              await this.plugin.saveSettings();
            });
          }, 0);
        }
      });
  }

  // ════════════════════════════════════════════
  //  Advanced Global Settings
  // ════════════════════════════════════════════
  private addAdvancedSettings(containerEl: HTMLElement): void {
    const advancedDetails = containerEl.createEl("details", {
      cls: "llm-advanced-section",
    });
    advancedDetails.createEl("summary", {
      text: "Advanced settings",
      cls: "llm-section-summary",
    });
    const advancedContainer = advancedDetails.createDiv();

    // Default timeout
    new Setting(advancedContainer)
      .setName("Default timeout")
      .setDesc("How long to wait for a response before giving up (seconds)")
      .addSlider((slider) => {
        slider.setLimits(10, 600, 10);
        slider.setValue(this.plugin.settings.defaultTimeout);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.defaultTimeout = value;
          await this.plugin.saveSettings();
        });
      });

    // File writes
    new Setting(advancedContainer)
      .setName("Allow file editing")
      .setDesc("Let the AI create and modify files in your vault. Use with caution.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.allowFileWrites);
        toggle.onChange(async (value) => {
          this.plugin.settings.allowFileWrites = value;
          await this.plugin.saveSettings();
        });
      });

    // Debug mode
    new Setting(advancedContainer)
      .setName("Debug logging")
      .setDesc("Show detailed logs in the developer console (for troubleshooting)")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.debugMode);
        toggle.onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        });
      });
  }

  // ════════════════════════════════════════════
  //  Model Selection Dropdown
  // ════════════════════════════════════════════
  private addModelSetting(container: HTMLElement, provider: LLMProvider, currentValue: string): void {
    const setting = new Setting(container)
      .setName("Model")
      .setDesc("Pick a model or choose \"Custom\" to enter any model ID");

    let dropdown: DropdownComponent | null = null;
    let customInput: HTMLInputElement | null = null;
    let isCustomMode = false;

    const staticModels = PROVIDER_MODELS[provider];
    const isCurrentValueInList = staticModels.some((m) => m.value === currentValue);
    isCustomMode = currentValue !== "" && !isCurrentValueInList;

    setting.addDropdown((dd) => {
      dropdown = dd;
      this.populateModelDropdown(dd, staticModels, currentValue, isCustomMode);

      dd.onChange(async (value) => {
        if (value === "__custom__") {
          if (customInput) {
            customInput.style.display = "inline-block";
            customInput.focus();
          }
          isCustomMode = true;
        } else {
          if (customInput) {
            customInput.style.display = "none";
            customInput.value = "";
          }
          isCustomMode = false;
          this.plugin.settings.providers[provider].model = value || undefined;
          await this.plugin.saveSettings();
        }
      });

      if (ACP_SUPPORTED_PROVIDERS.includes(provider)) {
        this.fetchAndUpdateModels(dd, provider);
      }
    });

    customInput = setting.controlEl.createEl("input", {
      type: "text",
      cls: "llm-custom-model-input",
      attr: { placeholder: "e.g. claude-opus-4-6" },
    });
    customInput.style.display = isCustomMode ? "inline-block" : "none";
    customInput.style.marginLeft = "8px";
    customInput.style.width = "150px";

    if (isCustomMode) {
      customInput.value = currentValue;
    }

    customInput.addEventListener("change", async () => {
      const value = customInput!.value.trim();
      this.plugin.settings.providers[provider].model = value || undefined;
      await this.plugin.saveSettings();
    });
  }

  private populateModelDropdown(
    dropdown: DropdownComponent,
    models: ModelOption[],
    currentValue: string,
    isCustomMode: boolean
  ): void {
    dropdown.selectEl.empty();
    models.forEach((option) => {
      dropdown.addOption(option.value, option.label);
    });
    dropdown.addOption("__custom__", "Custom model...");

    if (isCustomMode) {
      dropdown.setValue("__custom__");
    } else {
      dropdown.setValue(currentValue);
    }
  }

  private async fetchAndUpdateModels(dropdown: DropdownComponent, provider: LLMProvider): Promise<void> {
    try {
      const models = await fetchModelsForProvider(provider);
      const currentValue = this.plugin.settings.providers[provider].model ?? "";
      const dropdownValue = dropdown.getValue();
      const isCustomMode = dropdownValue === "__custom__";
      const isInList = models.some((m) => m.value === currentValue);
      const shouldUseCustom = isCustomMode || (currentValue !== "" && !isInList);
      this.populateModelDropdown(dropdown, models, currentValue, shouldUseCustom);
    } catch {
      // Keep static models on error
    }
  }

  /**
   * Try to auto-start a local LLM server (Ollama, LM Studio, etc.)
   * when the connection test fails.
   */
  private async tryAutoStartLocalServer(_url: string, _type: string): Promise<boolean> {
    try {
      const { detectLocalSoftwareStatuses, startLocalServer: startSrv } = await import("../utils/autoDetect");
      const statuses = await detectLocalSoftwareStatuses();
      const startable = statuses.find((s) => s.installed && !s.serverRunning && s.canAutoStart);
      if (!startable) return false;

      new Notice(`Starting ${startable.name}...`);
      const result = await startSrv(startable.name);
      if (!result.ok) {
        new Notice(`Failed to start ${startable.name}: ${result.error}`);
        return false;
      }

      // Update settings to point at the started server
      this.plugin.settings.providers.local.serverUrl = startable.url;
      this.plugin.settings.providers.local.serverType = startable.type;
      await this.plugin.saveSettings();
      new Notice(`${startable.name} started`);
      return true;
    } catch {
      return false;
    }
  }

  private async refreshLocalModels(dropdown: DropdownComponent): Promise<void> {
    const config = this.plugin.settings.providers.local;
    try {
      const models = await fetchModelsForProvider("local", config);
      const currentValue = config.model ?? "";
      dropdown.selectEl.empty();
      models.forEach((m) => dropdown.addOption(m.value, m.label));
      if (currentValue && !models.some((m) => m.value === currentValue)) {
        dropdown.addOption(currentValue, currentValue);
      }
      dropdown.setValue(currentValue);
    } catch {
      // Keep existing options
    }
  }

  private getDefaultCommand(provider: LLMProvider): string {
    switch (provider) {
      case "claude": return "claude";
      case "opencode": return "opencode";
      case "codex": return "codex";
      case "gemini": return "gemini";
      case "local": return "";
    }
  }

  private getTemperatureLabel(temp: number): string {
    if (temp <= 0.2) return ` (${temp.toFixed(1)} — precise)`;
    if (temp <= 0.5) return ` (${temp.toFixed(1)} — focused)`;
    if (temp <= 0.8) return ` (${temp.toFixed(1)} — balanced)`;
    if (temp <= 1.2) return ` (${temp.toFixed(1)} — creative)`;
    return ` (${temp.toFixed(1)} — very creative)`;
  }
}
