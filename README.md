# Obsidian LLM Chat Integration

An Obsidian plugin that integrates with LLM CLI tools to bring AI-powered assistance directly into your vault — chat, summarize, explain, and generate content without leaving Obsidian.

Maintained by **Kai Detmers** (t3mr0i@googlemail.com).

## Supported Providers & Models

| Provider | Latest Models |
|----------|--------------|
| **Claude** (Anthropic) | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 |
| **Codex** (OpenAI) | GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano |
| **OpenCode** | Anthropic + OpenAI models via unified CLI |
| **Gemini** (Google) | Gemini 2.5 Pro, 2.5 Flash, 3 Pro/Flash Preview |

All models can be selected in settings or entered as a custom model ID.

## Features

- **Chat Panel** — Sidebar panel for multi-turn conversations with any supported LLM
- **Multiple Providers** — Claude, Codex, OpenCode, and Gemini CLI tools in one plugin
- **Open Files Context** — Optionally include content from open notes as context
- **System Prompt from File** — Use any markdown note in your vault as the system prompt
- **Progress Indicators** — Real-time feedback on what the model is doing (reading files, searching, etc.)
- **Markdown Rendering** — Responses rendered with full Obsidian markdown support, including internal `[[links]]`
- **Interactive Elements** — Checkboxes and buttons in responses are clickable; the LLM is notified on interaction
- **Create Notes from Responses** — Save any LLM response as a new note with one click
- **Quick Commands** — Summarize, explain, and improve selected text via command palette
- **Session Continuation** — Follow-up messages reuse the active session for faster responses
- **ACP Mode** — Persistent connection mode (Agent Client Protocol) for low-latency multi-turn conversations

## Requirements

At least one LLM CLI tool must be installed and available in your `PATH`:

- **[Claude CLI](https://github.com/anthropics/claude-cli)** — `claude`
- **[Codex CLI](https://github.com/openai/codex)** — `codex`
- **[OpenCode](https://github.com/opencode-ai/opencode)** — `opencode`
- **[Gemini CLI](https://github.com/google/gemini-cli)** — `gemini`

## Installation

### BRAT (Recommended)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is the easiest way to install and keep the plugin updated automatically:

1. Install BRAT from Obsidian's Community Plugins
2. Open BRAT settings → "Add Beta Plugin"
3. Enter the repository path
4. Enable the plugin under Community Plugins

### Manual Installation

1. Download the latest release from the [releases page](https://github.com/t3mr0i/obsidian-llmchat-integration-/releases)
2. Copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/obsidian-llm/`
3. Enable the plugin in Obsidian settings

### Build from Source

```bash
git clone https://github.com/t3mr0i/obsidian-llmchat-integration-.git
cd obsidian-llmchat-integration-
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-llm/` folder.

## Usage

### Chat Panel

1. Click the message icon in the ribbon, or use the command **"LLM: Open Chat"**
2. The panel opens in the right sidebar
3. Type your message and press `Enter` to send (`Shift+Enter` for newlines)
4. Toggle **"Include open files"** to add your open notes as context

**Message Actions** (hover over any assistant message):
- **Copy** — Copy the response to clipboard
- **Create Note** — Save the response as a new note in your vault

### Quick Commands

| Command | Description |
|---------|-------------|
| LLM: Quick Prompt | Open a freeform prompt dialog |
| LLM: Send Selection to LLM | Send selected text to the LLM |
| LLM: Summarize Selection | Summarize selected text |
| LLM: Explain Selection | Get an explanation of selected text |
| LLM: Improve Writing | Rewrite selected text with improved style |
| LLM: Generate from Current Note Context | Generate content based on the active note |

### Settings

- **Default Provider** — Which LLM to use when no provider is specified
- **System Prompt File** — A markdown note to use as the system prompt for all requests
- **Default Timeout** — Global timeout for LLM requests (overridable per provider)
- **Conversation History** — Number of prior messages included as context
- **Allow File Writes** — Grant the LLM permission to create/edit files in your vault

## Provider Configuration

Each provider supports:
- Enable / disable
- **Model** — Dropdown with up-to-date presets, or enter a custom model ID
- **Custom Command** — Override the CLI binary name if needed
- **Timeout** — Per-provider timeout override
- **ACP Mode** — Persistent connection for faster multi-turn conversations
- **Thinking Mode** (ACP only) — `none` / `low` / `medium` / `high`

## Architecture

### Session Continuation

The plugin captures session IDs returned by CLI tools and reuses them for follow-up messages:

- **Claude** — `--resume <session_id>`
- **OpenCode** — `--session <session_id>`
- **Gemini** — `--resume <session_id>`
- **Codex** — `--resume <session_id>`

Clearing the conversation resets the session.

### ACP Mode (Agent Client Protocol)

ACP is a standardized protocol for AI agents (similar to LSP for editors) providing:

- **Persistent connections** — No cold-start overhead per request
- **Streaming responses** — Real-time token delivery via JSON-RPC
- **Dynamic model discovery** — Model list fetched directly from the running agent
- **Extended thinking** — Configurable thinking depth per provider

Supported providers in ACP mode:

| Provider | ACP Adapter |
|----------|-------------|
| Claude | `@anthropic-ai/claude-code-acp` |
| OpenCode | Native `opencode acp` server |
| Gemini | `gemini --experimental-acp` flag |
| Codex | `@zed-industries/codex-acp` |

Enable ACP in the provider settings. The first message establishes the connection; all subsequent messages reuse it.

## Development

```bash
# Install dependencies
npm install

# Watch mode for development
npm run dev

# Production build
npm run build
```

### Testing in Obsidian

```bash
# Symlink the plugin into a test vault
ln -s /path/to/obsidian-llmchat-integration- /path/to/vault/.obsidian/plugins/obsidian-llm

# Start watch build
npm run dev
```

Use `Cmd/Ctrl+R` in Obsidian to reload, and `Cmd/Ctrl+Shift+I` to open the developer console.

### E2E Tests

The plugin uses [wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service) for end-to-end testing against a real Obsidian instance:

```bash
# Full run (build + test)
npm run test:e2e

# Tests only (assumes already built)
npm run wdio
```

Tests cover plugin loading, chat panel UI, user interaction, settings navigation, and context toggles. CI runs automatically on GitHub Actions.

## License

MIT

## Contact

Kai Detmers — t3mr0i@googlemail.com
