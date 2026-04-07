<!-- cai:start -->
---
description: "Key architectural decisions with reasoning and alternatives considered."
globs:
  - "src/**"
---

# decisions (auto-generated — edit .cai/context/decisions.md)

# Decisions

## Decision Log

## Token Optimization

### Prompt Caching
When building API integrations with Claude, structure prompts for cache efficiency:
- Place stable content first (system prompt, tool definitions), variable content last (user messages).
- Anthropic caches prompt prefixes automatically. A cache hit costs 90% less than processing.
- Minimum cacheable size: 2,048 tokens (Sonnet), 4,096 tokens (Opus/Haiku).
- Cache TTL: 5 minutes (default) or 1 hour (2x write cost, pays off after 2 reads).
- If tool definitions change, all downstream cache is invalidated — keep tools stable.

### Token-Efficient Tool Use
When using Claude API with tools, add the beta header `token-efficient-tools-2025-02-19`.
This reduces output token usage for tool calls by up to 70% (average 14%).
Available for Sonnet 4.6, Opus 4.6, and Haiku 4.5.

### Why Output Brevity Matters
Output tokens cost 5x more than input tokens across all Claude models.
A single instruction like "keep responses concise" in CLAUDE.md can save more money
than elaborate input-token optimization strategies.
<!-- cai:end -->
