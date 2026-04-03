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

export class LLMSettingTab extends PluginSettingTab {
  plugin: LLMPlugin;

  constructor(app: App, plugin: LLMPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "LLM Integration Settings" });

    // Default provider dropdown
    new Setting(containerEl)
      .setName("Default Provider")
      .setDesc("Which LLM provider to use by default")
      .addDropdown((dropdown) => {
        const providers: LLMProvider[] = ["claude", "opencode", "codex", "gemini", "local"];
        providers.forEach((provider) => {
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
      .setName("Response Insert Position")
      .setDesc("Where to insert LLM responses in the document")
      .addDropdown((dropdown) => {
        dropdown.addOption("cursor", "At cursor position");
        dropdown.addOption("end", "At end of document");
        dropdown.addOption("replace-selection", "Replace selection");
        dropdown.setValue(this.plugin.settings.insertPosition);
        dropdown.onChange(async (value) => {
          this.plugin.settings.insertPosition = value as "cursor" | "end" | "replace-selection";
          await this.plugin.saveSettings();
        });
      });

    // Streaming output toggle
    new Setting(containerEl)
      .setName("Stream Output")
      .setDesc("Show LLM response as it streams in (when supported)")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.streamOutput);
        toggle.onChange(async (value) => {
          this.plugin.settings.streamOutput = value;
          await this.plugin.saveSettings();
        });
      });

    // System prompt file picker
    const systemPromptSetting = new Setting(containerEl)
      .setName("System Prompt File")
      .setDesc("Select a markdown file to use as the system prompt (optional)");

    const systemPromptInput = systemPromptSetting.controlEl.createEl("input", {
      type: "text",
      cls: "llm-file-input",
      attr: {
        placeholder: "No file selected",
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

    // Default timeout
    new Setting(containerEl)
      .setName("Default Timeout")
      .setDesc("Default timeout in seconds for all providers (can be overridden per-provider)")
      .addSlider((slider) => {
        slider.setLimits(10, 600, 10);
        slider.setValue(this.plugin.settings.defaultTimeout);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.defaultTimeout = value;
          await this.plugin.saveSettings();
        });
      });

    // Provider-specific settings
    containerEl.createEl("h3", { text: "Provider Settings" });

    const providers: LLMProvider[] = ["claude", "opencode", "codex", "gemini"];
    providers.forEach((provider) => {
      this.addProviderSettings(containerEl, provider);
    });

    // Conversation history settings
    containerEl.createEl("h3", { text: "Conversation History" });

    new Setting(containerEl)
      .setName("Enable Conversation History")
      .setDesc("Maintain context across multiple prompts in a session")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.conversationHistory.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.conversationHistory.enabled = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Max History Messages")
      .setDesc("Maximum number of previous messages to include as context")
      .addSlider((slider) => {
        slider.setLimits(1, 50, 1);
        slider.setValue(this.plugin.settings.conversationHistory.maxMessages);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.conversationHistory.maxMessages = value;
          await this.plugin.saveSettings();
        });
      });

    // Advanced settings
    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl)
      .setName("Allow File Writes")
      .setDesc("Allow LLM to write and edit files. For Claude, this enables --dangerously-skip-permissions flag. Use with caution.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.allowFileWrites);
        toggle.onChange(async (value) => {
          this.plugin.settings.allowFileWrites = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Debug Mode")
      .setDesc("Log detailed execution info to the developer console (Ctrl+Shift+I)")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.debugMode);
        toggle.onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        });
      });
  }

  private addProviderSettings(containerEl: HTMLElement, provider: LLMProvider): void {
    if (provider === "local") {
      this.addLocalProviderSettings(containerEl);
      return;
    }

    const providerConfig = this.plugin.settings.providers[provider];
    const displayName = PROVIDER_DISPLAY_NAMES[provider];

    const detailsEl = containerEl.createEl("details", {
      cls: "llm-provider-details",
    });
    detailsEl.createEl("summary", { text: displayName });

    const settingsContainer = detailsEl.createDiv({ cls: "llm-provider-settings" });

    new Setting(settingsContainer)
      .setName("Enabled")
      .setDesc(`Enable ${displayName} as an available provider`)
      .addToggle((toggle) => {
        toggle.setValue(providerConfig.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.providers[provider].enabled = value;
          await this.plugin.saveSettings();
        });
      });

    // Model selection - with dynamic fetching and custom input
    this.addModelSetting(settingsContainer, provider, providerConfig.model ?? "");

    new Setting(settingsContainer)
      .setName("Custom Command")
      .setDesc("Override the default CLI command (leave empty for default)")
      .addText((text) => {
        text.setPlaceholder(this.getDefaultCommand(provider));
        text.setValue(providerConfig.customCommand ?? "");
        text.onChange(async (value) => {
          this.plugin.settings.providers[provider].customCommand = value || undefined;
          await this.plugin.saveSettings();
        });
      });

    // Gemini-specific: Yolo mode
    if (provider === "gemini") {
      new Setting(settingsContainer)
        .setName("Yolo Mode")
        .setDesc("Auto-confirm dangerous operations without prompting. Required for non-interactive use.")
        .addToggle((toggle) => {
          toggle.setValue(providerConfig.yoloMode ?? false);
          toggle.onChange(async (value) => {
            this.plugin.settings.providers[provider].yoloMode = value;
            await this.plugin.saveSettings();
          });
        });
    }

    // ACP mode for supported providers
    if (ACP_SUPPORTED_PROVIDERS.includes(provider)) {
      // Create thinking mode setting first so we can reference it in ACP toggle
      const thinkingModeSetting = new Setting(settingsContainer)
        .setName("Thinking Mode (ACP)")
        .setDesc('Extended thinking level. Common values: "none", "low", "medium", "high". Leave empty for agent default.')
        .addText((text) => {
          text.setPlaceholder("Agent default");
          text.setValue(providerConfig.thinkingMode ?? "");
          text.onChange(async (value) => {
            this.plugin.settings.providers[provider].thinkingMode = value.trim() || undefined;
            await this.plugin.saveSettings();
          });
        });

      // Initially show/hide based on current ACP setting
      thinkingModeSetting.settingEl.style.display = providerConfig.useAcp ? "" : "none";

      // ACP toggle - insert before thinking mode setting
      const acpSetting = new Setting(settingsContainer)
        .setName("Use ACP Mode")
        .setDesc("Use Agent Client Protocol for persistent connection. Faster for multi-turn conversations. Disable to use CLI subprocess per request.")
        .addToggle((toggle) => {
          toggle.setValue(providerConfig.useAcp ?? false);
          toggle.onChange(async (value) => {
            this.plugin.settings.providers[provider].useAcp = value;
            await this.plugin.saveSettings();
            // Show/hide thinking mode setting based on ACP toggle
            thinkingModeSetting.settingEl.style.display = value ? "" : "none";
          });
        });

      // Move ACP setting before thinking mode setting in the DOM
      settingsContainer.insertBefore(acpSetting.settingEl, thinkingModeSetting.settingEl);
    }

    // Timeout override (optional)
    const timeoutSetting = new Setting(settingsContainer)
      .setName("Timeout Override (seconds)")
      .setDesc(`Override the default timeout (current default: ${this.plugin.settings.defaultTimeout}s). Leave empty to use default.`);

    const timeoutInput = timeoutSetting.controlEl.createEl("input", {
      type: "number",
      cls: "llm-timeout-input",
      attr: {
        placeholder: `Default (${this.plugin.settings.defaultTimeout}s)`,
        min: "10",
        max: "600",
        step: "10",
      },
    });
    timeoutInput.value = providerConfig.timeout?.toString() ?? "";
    timeoutInput.addEventListener("change", async () => {
      const value = timeoutInput.value.trim();
      if (value === "") {
        this.plugin.settings.providers[provider].timeout = undefined;
      } else {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue) && numValue >= 10 && numValue <= 600) {
          this.plugin.settings.providers[provider].timeout = numValue;
        }
      }
      await this.plugin.saveSettings();
    });

    const clearTimeoutBtn = timeoutSetting.controlEl.createEl("button", {
      text: "Use Default",
      cls: "llm-clear-btn",
    });
    clearTimeoutBtn.addEventListener("click", async () => {
      this.plugin.settings.providers[provider].timeout = undefined;
      timeoutInput.value = "";
      await this.plugin.saveSettings();
    });
  }

  /**
   * Add model selection setting with dropdown + custom input
   * Fetches available models dynamically for providers that support it
   */
  private addModelSetting(container: HTMLElement, provider: LLMProvider, currentValue: string): void {
    const setting = new Setting(container)
      .setName("Model")
      .setDesc("Select a model or enter a custom model ID");

    let dropdown: DropdownComponent | null = null;
    let customInput: HTMLInputElement | null = null;
    let isCustomMode = false;

    // Check if current value is in the static list (to determine if using custom)
    const staticModels = PROVIDER_MODELS[provider];
    const isCurrentValueInList = staticModels.some((m) => m.value === currentValue);
    isCustomMode = currentValue !== "" && !isCurrentValueInList;

    // Add dropdown
    setting.addDropdown((dd) => {
      dropdown = dd;

      // Add static options first (will be updated with dynamic ones)
      this.populateModelDropdown(dd, staticModels, currentValue, isCustomMode);

      dd.onChange(async (value) => {
        if (value === "__custom__") {
          // Switch to custom mode
          if (customInput) {
            customInput.style.display = "inline-block";
            customInput.focus();
          }
          isCustomMode = true;
        } else {
          // Use selected model
          if (customInput) {
            customInput.style.display = "none";
            customInput.value = "";
          }
          isCustomMode = false;
          this.plugin.settings.providers[provider].model = value || undefined;
          await this.plugin.saveSettings();
        }
      });

      // Fetch dynamic models in the background for all ACP-supported providers
      // ACP models will be preferred if available (cached when ACP connects)
      if (ACP_SUPPORTED_PROVIDERS.includes(provider)) {
        this.fetchAndUpdateModels(dd, provider);
      }
    });

    // Add custom input (hidden by default unless in custom mode)
    customInput = setting.controlEl.createEl("input", {
      type: "text",
      cls: "llm-custom-model-input",
      attr: {
        placeholder: "Enter model ID...",
      },
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

  /**
   * Populate dropdown with model options
   */
  private populateModelDropdown(
    dropdown: DropdownComponent,
    models: ModelOption[],
    currentValue: string,
    isCustomMode: boolean
  ): void {
    // Clear existing options
    dropdown.selectEl.empty();

    // Add model options
    models.forEach((option) => {
      dropdown.addOption(option.value, option.label);
    });

    // Add custom option at the end
    dropdown.addOption("__custom__", "Custom model...");

    // Set current value
    if (isCustomMode) {
      dropdown.setValue("__custom__");
    } else {
      dropdown.setValue(currentValue);
    }
  }

  /**
   * Fetch models dynamically and update dropdown
   */
  private async fetchAndUpdateModels(dropdown: DropdownComponent, provider: LLMProvider): Promise<void> {
    try {
      const models = await fetchModelsForProvider(provider);

      // Read the current value at update time (not from captured closure values)
      // This avoids race conditions if user changed selection during fetch
      const currentValue = this.plugin.settings.providers[provider].model ?? "";
      const dropdownValue = dropdown.getValue();
      const isCustomMode = dropdownValue === "__custom__";

      // Check if current value is in the new list
      const isInList = models.some((m) => m.value === currentValue);
      const shouldUseCustom = isCustomMode || (currentValue !== "" && !isInList);

      this.populateModelDropdown(dropdown, models, currentValue, shouldUseCustom);
    } catch {
      // Keep static models on error
    }
  }

  private getDefaultCommand(provider: LLMProvider): string {
    switch (provider) {
      case "claude":
        return "claude";
      case "opencode":
        return "opencode";
      case "codex":
        return "codex";
      case "gemini":
        return "gemini";
      case "local":
        return "";
    }
  }

  /**
   * Settings UI for the local LLM provider
   */
  private addLocalProviderSettings(containerEl: HTMLElement): void {
    const providerConfig = this.plugin.settings.providers.local;

    const detailsEl = containerEl.createEl("details", {
      cls: "llm-provider-details",
    });
    detailsEl.createEl("summary", { text: "Local LLM (Ollama, LM Studio, ...)" });

    const settingsContainer = detailsEl.createDiv({ cls: "llm-provider-settings" });

    // Enable toggle
    new Setting(settingsContainer)
      .setName("Enabled")
      .setDesc("Enable local LLM server as a provider")
      .addToggle((toggle) => {
        toggle.setValue(providerConfig.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.providers.local.enabled = value;
          await this.plugin.saveSettings();
        });
      });

    // Server type
    new Setting(settingsContainer)
      .setName("Server type")
      .setDesc("Select your local LLM server type")
      .addDropdown((dropdown) => {
        dropdown.addOption("ollama", "Ollama (localhost:11434)");
        dropdown.addOption("openai-compatible", "OpenAI-compatible (LM Studio, vLLM, ...)");
        dropdown.setValue(providerConfig.serverType || "ollama");
        dropdown.onChange(async (value) => {
          this.plugin.settings.providers.local.serverType = value as LocalServerType;
          // Update default URL based on type
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
      .setName("Server URL")
      .setDesc("URL of your local LLM server");

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

    // Connection test + model fetch
    const testSetting = new Setting(settingsContainer)
      .setName("Connection")
      .setDesc("Test the connection and fetch available models");

    const resultEl = testSetting.controlEl.createEl("span", {
      cls: "llm-connection-result",
    });

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
          resultEl.textContent = `Connected (${result.models?.length || 0} models)`;
          resultEl.className = "llm-connection-result llm-connection-success";
          // Refresh model dropdown
          if (modelDropdown) {
            await this.refreshLocalModels(modelDropdown);
          }
        } else {
          resultEl.textContent = result.error || "Connection failed";
          resultEl.className = "llm-connection-result llm-connection-error";
        }
      });
    });

    // Model dropdown
    let modelDropdown: DropdownComponent | null = null;

    const modelSetting = new Setting(settingsContainer)
      .setName("Model")
      .setDesc("Select a model from your server (test connection first)");

    modelSetting.addDropdown((dd) => {
      modelDropdown = dd;
      dd.addOption("", "Select a model...");

      // Try to populate from server
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
      btn.setTooltip("Refresh models");
      btn.onClick(async () => {
        if (modelDropdown) {
          await this.refreshLocalModels(modelDropdown);
        }
      });
    });

    // Temperature
    new Setting(settingsContainer)
      .setName("Temperature")
      .setDesc("Controls randomness (0.0 = deterministic, 2.0 = very random)")
      .addSlider((slider) => {
        slider.setLimits(0, 200, 5);
        slider.setValue((providerConfig.temperature ?? 0.7) * 100);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.providers.local.temperature = value / 100;
          await this.plugin.saveSettings();
        });
      });

    // Max tokens
    const maxTokensSetting = new Setting(settingsContainer)
      .setName("Max tokens")
      .setDesc("Maximum tokens in response (0 = server default)");

    const maxTokensInput = maxTokensSetting.controlEl.createEl("input", {
      type: "number",
      cls: "llm-timeout-input",
      attr: { placeholder: "0", min: "0", max: "128000", step: "256" },
    });
    maxTokensInput.value = (providerConfig.maxTokens || 0).toString();
    maxTokensInput.addEventListener("change", async () => {
      const val = parseInt(maxTokensInput.value, 10);
      this.plugin.settings.providers.local.maxTokens = isNaN(val) ? 0 : val;
      await this.plugin.saveSettings();
    });
  }

  /**
   * Refresh model dropdown from local server
   */
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
}
