# Floor Ops Console

A live floor-ops console for a hackathon marshal: check in teams, watch a room-wide radar of who needs help, triage requests with an AI-drafted ticket, and file the ones that need a helper as GitHub issues — with a REST API for an optional physical pager device.

## What it does

- **Team check-in** — teams register themselves with a table label, a one-line description of what they're building, and optional workspace/GitHub links.
- **Room radar** — every team as a card, color-coded by status (`fine`, `stuck`, `page_now`, `do_not_disturb`), so the marshal can see the whole floor at a glance.
- **Help queue** — open tickets sorted by urgency, with the room-wide counts (teams paging now, stuck, time remaining) in the header.
- **Team dossier** — a full timeline of check-ins, moderator notes, and system events for one team, plus its ticket history.
- **AI-drafted tickets** — one click turns a team's recent signals (pings + an optional moderator note) into a structured triage card and a draft GitHub issue body, using Claude (Anthropic) via Replit AI Integrations. The marshal always reviews, edits, or discards the draft before anything is filed.
- **GitHub filing with fallback** — filing opens a real issue on the team's repo if they gave one; if they didn't, or GitHub rejects the write, it falls back to a Marshal-only ticket automatically. Resolving a filed ticket comments on and closes the GitHub issue.
- **Pager hardware API** — a small set of stub REST endpoints (`/pager/state`, `/pager/ack`) meant to be polled by an external hardware pager (see [`hardware/esp32-s3-pager/`](hardware/esp32-s3-pager/README.md) for a Waveshare ESP32-S3 firmware stub). The pager itself is not part of this repo's build — you flash and run it separately.

## Architecture

This is a pnpm monorepo with two runnable services (called "artifacts") and a set of shared libraries generated from a single API contract.

```
artifacts/
  api-server/     Express 5 API — all backend logic lives here
  floor-ops/      React + Vite web app — the marshal-facing console
  mockup-sandbox/ Component preview sandbox (design tooling, not part of the product)
lib/
  api-spec/       lib/api-spec/openapi.yaml — the API contract (source of truth)
  api-zod/        Generated Zod schemas (via Orval, from the OpenAPI spec)
  api-client-react/ Generated React Query hooks (via Orval, from the OpenAPI spec)
  db/             Drizzle ORM schema + client (Postgres)
  integrations-anthropic-ai/  Anthropic SDK client + batch helpers (Replit AI Integrations proxy)
hardware/
  esp32-s3-pager/ Firmware stub + wiring guide for a Waveshare ESP32-S3 physical pager
```

**The OpenAPI spec is the source of truth for the API.** Route paths, request/response shapes, and the generated Zod schemas and React hooks all derive from `lib/api-spec/openapi.yaml`. After editing it, regenerate before touching routes or frontend code:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Tech stack

- **Runtime:** Node.js 24, TypeScript 5.9, pnpm workspaces
- **Backend:** Express 5, Drizzle ORM, PostgreSQL, Zod (`zod/v4`)
- **Frontend:** React + Vite, wouter (routing), TanStack Query, Tailwind CSS v4, shadcn/ui
- **AI:** Claude (`claude-sonnet-5`) via Replit AI Integrations — drafts ticket cards from team signals, using forced tool-use for structured JSON output
- **GitHub:** Replit's GitHub connector (OAuth, no stored token) — files and closes issues through an authenticated proxy
- **Codegen:** Orval turns the OpenAPI spec into typed Zod schemas and React Query hooks

## Getting started

```bash
pnpm install

# Run the API server (Express, port from artifact config)
pnpm --filter @workspace/api-server run dev

# Run the web app (Vite dev server)
pnpm --filter @workspace/floor-ops run dev
```

Other useful commands:

```bash
pnpm run typecheck                                  # full monorepo typecheck
pnpm run build                                      # typecheck + build all packages
pnpm --filter @workspace/api-spec run codegen        # regenerate Zod schemas + React hooks from the OpenAPI spec
pnpm --filter @workspace/db run push                 # push Drizzle schema changes to the database (dev only)
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Replit AI Integrations proxy for Claude (auto-provisioned, no user key needed) |

The GitHub connector is authorized per-account through Replit's integrations system (no API key stored in this repo) and used server-side via `@replit/connectors-sdk`.

## Data model

Four tables (`lib/db/src/schema/`), all enum-like fields stored as plain `text` and validated at the API boundary by generated Zod schemas:

- **teams** — name, table label, what they're building, current `phase`, `helpType`, links (workspace/GitHub), `moderatorEnRoute`, `lastPingAt`
- **pings** — a timestamped event on a team's timeline: `team_checkin`, `team_signal`, `moderator_note`, or `system`
- **tickets** — a triage card: `phase`, `blockerType`, `skill`, `summary`, `etaMinutes`, `risk`, drafted issue title/body/labels, `status` (`draft` → `filed`/`discarded` → `resolved`), and `sink` (`github_repo` or `marshal_only`)
- **event_settings** — a singleton row (`id = 1`) holding the event end time shown as a countdown

## Ticket lifecycle

1. **Draft** — `POST /teams/:teamId/tickets/draft` asks Claude to turn the team's recent pings (plus an optional moderator note) into a structured card. Nothing is filed yet.
2. **Review** — the marshal can edit any field (`PATCH /tickets/:ticketId`) or discard it (`POST /tickets/:ticketId/discard`).
3. **File** — `POST /tickets/:ticketId/file` opens a GitHub issue if the team gave a repo URL; if not, or if GitHub rejects the write, it files as `sink: "marshal_only"` instead. The marshal is never blocked by a GitHub-side failure.
4. **Resolve** — `POST /tickets/:ticketId/resolve` closes the GitHub issue (best-effort, if filed there), resets the team's `helpType` to `fine`, and clears `moderatorEnRoute`.

## API overview

Full contract: [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml). All routes are served under `/api`.

| Tag | Endpoints |
| --- | --- |
| `teams` | `GET/POST /teams`, `GET/PATCH /teams/:teamId`, `POST /teams/:teamId/pings`, `POST /teams/:teamId/tickets/draft` |
| `tickets` | `GET /tickets`, `PATCH /tickets/:ticketId`, `POST /tickets/:ticketId/file`, `POST /tickets/:ticketId/discard`, `POST /tickets/:ticketId/resolve` |
| `dashboard` | `GET /dashboard/summary` |
| `event` | `GET/PATCH /event` |
| `pager` | `GET /pager/state`, `POST /pager/ack` — see [hardware guide](hardware/esp32-s3-pager/README.md) |
| `health` | `GET /healthz` |

## Pager hardware

The `pager` endpoints are REST stubs meant for an external device — nothing in this repo runs on the hardware itself. See [`hardware/esp32-s3-pager/README.md`](hardware/esp32-s3-pager/README.md) for a wiring guide and a starter firmware sketch for a Waveshare ESP32-S3 board that polls the help queue and acknowledges tickets from a physical button.

## Deployment

This project deploys through Replit's standard publish flow (each artifact — API server and web app — has its own service). See the Deployments pane in the workspace, or ask the agent to publish.
