---
name: Anthropic vs OpenAI integration scope
description: The OpenAI AI-integration proxy cannot serve Claude/Anthropic models, even if asked to by model name.
---

Replit's OpenAI AI-integration (`AI_INTEGRATIONS_OPENAI_BASE_URL`/`_API_KEY`, `lib/integrations-openai-ai-server`) is a proxy to OpenAI's own model catalog only. Passing an Anthropic model name (e.g. `claude-sonnet-5`) as the `model` field to that client does not route the request to Anthropic — it is a different provider with a different integration.

**Why:** A user asked to "use OpenAI only but use the claude sonnet 5 model," which is contradictory: the two providers are set up as separate Replit AI integrations, each with their own env vars and SDK client. There is no single integration that lets you pick either vendor's models through one client.

**How to apply:** If a request names a model from a different provider than the integration in use, don't try to force it through — surface the contradiction and ask which provider they actually want, or set up the correct provider's integration (see `ai-integrations-anthropic` / `ai-integrations-openai` skills).
