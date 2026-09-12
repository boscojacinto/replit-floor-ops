---
name: Anthropic structured JSON output
description: How to get reliable structured (JSON-shaped) output from Claude via the Anthropic messages API, unlike OpenAI's response_format.
---

OpenAI's chat completions API has a `response_format: { type: "json_object" }` mode that guarantees valid JSON text back. The Anthropic messages API has no equivalent flag.

**Why:** Porting a ticket-drafting feature from OpenAI to Claude (`claude-sonnet-5`) that relied on `response_format: json_object` needed a different approach — prompting Claude to "return JSON" in free text is not reliable enough for a field that's parsed and validated against enums.

**How to apply:** For structured output from Claude, define a single tool with an `input_schema` matching the desired shape, pass it in `tools`, and force it with `tool_choice: { type: "tool", name: "<tool_name>" }`. Then read the parsed object straight off the `tool_use` content block's `input` field (no `JSON.parse` needed — the SDK already parses it). This is more reliable than prompting for raw JSON text.
