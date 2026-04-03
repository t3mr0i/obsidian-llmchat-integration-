import { App, DropdownComponent, FuzzySuggestModal, PluginSettingTab, Setting, TFile } from "obsidian";
import type LLMPlugin from "../../main";
import type { LLMProvider, LocalServerType } from "../types";
import { PROVIDER_MODELS, ACP_SUPPORTED_PROVIDERS } from "../types";
import { fetchModelsForProvider, type ModelOption } from "../utils/modelFetcher";
import { LocalLLMExecutor } from "../executor/LocalLLMExecutor";

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

  constructor(app: App, plugin: LLMPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("llm-settings");

    // ── Header ──
    containerEl.createEl("h2", { text: "LLM Integration" });
    containerEl.createEl("p", {
      text: "Chat with AI models directly in Obsidian. Choose a provider below to get started.",
      cls: "setting-item-description",
    });

    // ── Section 1: General ──
    this.addGeneralSettings(containerEl);

    // ── Section 2: Providers ──
    this.addProvidersSection(containerEl);

    // ── Section 3: Conversation ──
    this.addConversationSettings(containerEl);

    // ── Section 4: Advanced (collapsed) ──
    this.addAdvancedSettings(containerEl);
  }

  // ════════════════════════════════════════════
  //  General Settings
  // ════════════════════════════════════════════
  private addGeneralSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "General" });

    // Default provider
    new Setting(containerEl)
      .setName("Default AI provider")
      .setDesc("Which AI to use when you open a new chat")
      .addDropdown((dropdown) => {
        const allProviders: LLMProvider[] = ["claude", "opencode", "codex", "gemini", "local"];
        allProviders.forEach((provider) => {
          dropdown.addOption(provider, PROVIDER_DISPLAY_NAMES[provider]);
        });
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
    containerEl.createEl("p", {
      text: "Enable the providers you want to use. Cloud providers need their CLI tool installed; Local LLM connects to a server on your machine.",
      cls: "setting-item-description",
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

  // ════════════════════════════════════════════
  //  Cloud Provider Settings (simplified)
  // ════════════════════════════════════════════
  private addCloudProviderSettings(containerEl: HTMLElement, provider: Exclude<LLMProvider, "local">): void {
    const providerConfig = this.plugin.settings.providers[provider];
    const displayName = PROVIDER_DISPLAY_NAMES[provider];

    const detailsEl = containerEl.createEl("details", {
      cls: "llm-provider-details",
    });

    // Summary with enable toggle inline
    const summaryEl = detailsEl.createEl("summary");
    const summaryContent = summaryEl.createDiv({ cls: "llm-provider-summary" });
    summaryContent.createSpan({ text: displayName, cls: "llm-provider-name" });
    summaryContent.createSpan({
      text: providerConfig.enabled ? "Enabled" : "Disabled",
      cls: `llm-provider-badge ${providerConfig.enabled ? "llm-badge-enabled" : "llm-badge-disabled"}`,
    });

    const settingsContainer = detailsEl.createDiv({ cls: "llm-provider-settings" });

    // Description
    settingsContainer.createEl("p", {
      text: PROVIDER_DESCRIPTIONS[provider],
      cls: "setting-item-description llm-provider-desc",
    });

    // Enable toggle
    new Setting(settingsContainer)
      .setName("Enable")
      .addToggle((toggle) => {
        toggle.setValue(providerConfig.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.providers[provider].enabled = value;
          // Update badge in summary
          const badge = summaryContent.querySelector(".llm-provider-badge");
          if (badge) {
            badge.textContent = value ? "Enabled" : "Disabled";
            badge.className = `llm-provider-badge ${value ? "llm-badge-enabled" : "llm-badge-disabled"}`;
          }
          await this.plugin.saveSettings();
        });
      });

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

    const detailsEl = containerEl.createEl("details", {
      cls: "llm-provider-details",
    });

    const summaryEl = detailsEl.createEl("summary");
    const summaryContent = summaryEl.createDiv({ cls: "llm-provider-summary" });
    summaryContent.createSpan({ text: "Local LLM", cls: "llm-provider-name" });
    summaryContent.createSpan({
      text: providerConfig.enabled ? "Enabled" : "Disabled",
      cls: `llm-provider-badge ${providerConfig.enabled ? "llm-badge-enabled" : "llm-badge-disabled"}`,
    });

    const settingsContainer = detailsEl.createDiv({ cls: "llm-provider-settings" });

    settingsContainer.createEl("p", {
      text: PROVIDER_DESCRIPTIONS.local,
      cls: "setting-item-description llm-provider-desc",
    });

    // Enable
    new Setting(settingsContainer)
      .setName("Enable")
      .addToggle((toggle) => {
        toggle.setValue(providerConfig.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.providers.local.enabled = value;
          const badge = summaryContent.querySelector(".llm-provider-badge");
          if (badge) {
            badge.textContent = value ? "Enabled" : "Disabled";
            badge.className = `llm-provider-badge ${value ? "llm-badge-enabled" : "llm-badge-disabled"}`;
          }
          await this.plugin.saveSettings();
        });
      });

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
          if (value === "ollama" && (!providerConfig.serverUrl || providerConfig.serverUrl === "http://localhost:1234")) {
            this.plugin.settings.providers.local.serverUrl = "http://localhost:11434";
            serverUrlInput.value = "http://localhost:11434";
          } else if (value === "openai-compatible" && (!providerConfig.serverUrl || providerConfig.serverUrl === "http://localhost:11434")) {
            this.plugin.settings.providers.local.serverUrl = "http://localhost:1234";
            serverUrlInput.value = "http://localhost:1234";
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
      attr: { placeholder: "http://localhost:11434" },
    });
    serverUrlInput.value = providerConfig.serverUrl || "http://localhost:11434";
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

        const url = this.plugin.settings.providers.local.serverUrl || "http://localhost:11434";
        const type = this.plugin.settings.providers.local.serverType || "ollama";

        const result = await LocalLLMExecutor.testConnection(url, type);

        if (result.ok) {
          resultEl.textContent = `Connected — ${result.models?.length || 0} models found`;
          resultEl.className = "llm-connection-result llm-connection-success";
          if (modelDropdown) {
            await this.refreshLocalModels(modelDropdown);
          }
        } else {
          resultEl.textContent = result.error || "Could not connect";
          resultEl.className = "llm-connection-result llm-connection-error";
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
