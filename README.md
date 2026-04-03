# LLM Integration for Obsidian

Chat with AI models directly inside Obsidian — supports Claude, GPT, Gemini, and local models via Ollama.

![Version](https://img.shields.io/badge/version-0.3.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## What it does

This plugin adds a chat panel to Obsidian where you can talk to AI models. Ask questions, summarize notes, explain concepts, improve your writing — all without leaving your vault.

You can use cloud providers (Claude, GPT, Gemini) or run models locally on your own machine with Ollama or LM Studio.

## Supported Providers

| Provider | Models | How it connects |
|----------|--------|-----------------|
| **Claude** (Anthropic) | Opus 4.6, Sonnet 4.6, Haiku 4.5 | Claude CLI |
| **Codex** (OpenAI) | GPT-5.4, GPT-5.4 Mini/Nano, o3, o4-mini | Codex CLI |
| **OpenCode** | All Claude + GPT models | OpenCode CLI |
| **Gemini** (Google) | Gemini 3.1 Pro, 3 Flash, 2.5 Pro/Flash | Gemini CLI |
| **Local LLM** | Any model you have downloaded | Ollama, LM Studio, vLLM |

## Features

- **Chat Panel** — Sidebar panel for conversations with any AI model
- **Multiple Providers** — Switch between providers with one click
- **Local Models** — Run Llama, Mistral, Phi, or any GGUF model on your own machine
- **Open Files as Context** — Include your open notes so the AI knows what you're working on
- **Custom Instructions** — Use any note in your vault as a system prompt
- **Live Streaming** — See responses appear word-by-word as they're generated
- **Markdown Rendering** — Full Obsidian markdown support including `[[wiki links]]`
- **Progress Indicators** — See what the model is doing (reading files, thinking, searching)
- **Create Notes** — Save any AI response as a new note with one click
- **Quick Commands** — Summarize, explain, or improve selected text from the command palette

## Getting Started

### 1. Install the plugin

**Manual Installation:**

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/t3mr0i/obsidian-llmchat-integration-/releases)
2. Create a folder `<your-vault>/.obsidian/plugins/obsidian-llm/`
3. Copy the three files into that folder
4. Restart Obsidian and enable the plugin under Settings > Community Plugins

**Build from source:**

```bash
git clone https://github.com/t3mr0i/obsidian-llmchat-integration-.git
cd obsidian-llmchat-integration-
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-llm/` folder.

### 2. Set up a provider

**For cloud providers**, install the CLI tool for at least one provider:

| Provider | Install | Documentation |
|----------|---------|---------------|
| Claude | `npm install -g @anthropic-ai/claude-code` | [claude.ai/docs](https://docs.anthropic.com/en/docs/claude-code) |
| Codex | `npm install -g @openai/codex` | [github.com/openai/codex](https://github.com/openai/codex) |
| OpenCode | `curl -fsSL https://opencode.ai/install | bash` | [opencode.ai](https://opencode.ai) |
| Gemini | `npm install -g @anthropic-ai/gemini-cli` | [github.com/google/gemini-cli](https://github.com/google/gemini-cli) |

**For local models**, install [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai), download a model, and start the server. Then enable "Local LLM" in the plugin settings, test the connection, and select your model.

### 3. Open the chat

Click the message icon in the left ribbon, or run **"LLM: Open Chat"** from the command palette (`Cmd/Ctrl+P`).

## How to Use

### Chat Panel

- Type your message and press `Enter` to send (`Shift+Enter` for new lines)
- Toggle **"Include open files"** to give the AI context from your open notes
- Switch providers using the dropdown at the top
- Hover over any response to copy it or save it as a new note
- Click the trash icon to clear the conversation and start fresh

### Quick Commands

Open the command palette (`Cmd/Ctrl+P`) and search for:

| Command | What it does |
|---------|-------------|
| **Quick Prompt** | Opens a dialog to ask anything |
| **Send Selection to LLM** | Sends your selected text to the AI |
| **Summarize Selection** | Creates a summary of selected text |
| **Explain Selection** | Explains the selected text |
| **Improve Writing** | Rewrites selected text with better style |
| **Generate from Note Context** | Generates content based on the current note |

### Settings

Open Settings > LLM Integration to configure:

- **General** — Default provider, response placement, live streaming, custom instructions
- **Providers** — Enable/disable providers, select models, test connections
- **Conversation** — Memory length (how many messages the AI remembers)
- **Advanced** — Timeout, file editing permissions, debug logging

Each provider has its own "Advanced options" section for power users (persistent connections, custom CLI commands, thinking depth).

## Local LLM Setup

Running models locally means your data never leaves your machine.

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull llama3.2`
2. In plugin settings, expand **Local LLM** and toggle it on
3. Click **Test connection** — your models should appear in the dropdown
4. Select a model and start chatting

Works with any server that speaks the OpenAI-compatible API:
- **Ollama** (default, `localhost:11434`)
- **LM Studio** (`localhost:1234`)
- **vLLM**, **llama.cpp server**, **text-generation-webui**, etc.

## Development

```bash
npm install       # Install dependencies
npm run dev       # Watch mode (auto-rebuild on save)
npm run build     # Production build
```

### Testing locally

```bash
# Symlink into a test vault
ln -s "$(pwd)" /path/to/vault/.obsidian/plugins/obsidian-llm

# Start watch build, then reload Obsidian with Cmd/Ctrl+R
npm run dev
```

### E2E Tests

Uses [wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service) for end-to-end testing:

```bash
npm run test:e2e        # Build + test
npm run test:e2e:fast   # Quick subset
npm run wdio            # Tests only (skip build)
```

## License

MIT

## Author

Kai Detmers — [GitHub](https://github.com/t3mr0i) — t3mr0i@googlemail.com
