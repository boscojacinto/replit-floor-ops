# Ship It — Floor Ops Console

A hackathon floor-ops console for an event marshal: check in teams, track help requests on a room radar, and file AI-drafted GitHub issues for anything that needs a helper.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/floor-ops run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec (run after any `lib/api-spec/openapi.yaml` edit)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY` (all pre-provisioned)
- GitHub connector: `connection:conn_github_01M28V2AH53E1W3AGWHFSCK1D3`, used only server-side via `@replit/connectors-sdk`'s `ReplitConnectors().proxy("github", ...)`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`)
- Web: React + Vite (`artifacts/floor-ops`), wouter router, TanStack Query
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4` for schema files, generated client uses `zod` v3), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec) → `lib/api-zod`, `lib/api-client-react`
- AI: Anthropic via Replit AI Integrations proxy (`lib/integrations-anthropic-ai`), model `claude-sonnet-5`, used to draft ticket cards from team pings (structured output via forced tool use)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract source of truth. Tags: teams, tickets, dashboard, event, pager.
- `lib/db/src/schema/` — one file per table: `teams.ts`, `pings.ts`, `tickets.ts`, `event-settings.ts` (singleton row, `id=1`)
- `artifacts/api-server/src/routes/` — `teams.ts`, `tickets.ts`, `dashboard.ts`, `event.ts`, `pager.ts`
- `artifacts/api-server/src/lib/github.ts` — files/closes GitHub issues through the connector proxy; falls back gracefully (never throws to the caller) when the team's repo can't be written to
- `artifacts/api-server/src/lib/ticket-drafter.ts` — turns a team + recent pings + optional moderator note into a structured ticket card + draft GitHub issue body via Claude (Anthropic)
- `artifacts/floor-ops/src/pages/` — `dashboard.tsx` (room radar + help queue), `team-detail.tsx` (dossier), `check-in.tsx`, `settings.tsx`

## Architecture decisions

- Tickets always start as `draft` — the AI drafts, the moderator reviews/edits/discards before anything is filed. Filing is a separate explicit action (`POST /tickets/:id/file`).
- Filing falls back to `sink: "marshal_only"` automatically if the team gave no GitHub repo, or if GitHub rejects the write (wrong repo, no permission, etc.) — the moderator is never blocked by a GitHub-side failure.
- `TeamDetail` (the dossier endpoint) bundles team + pings + tickets in one fetch rather than three separate list endpoints, since the moderator always views them together.
- `/pager/*` endpoints are REST stubs for external pager hardware the user builds themselves — no frontend consumes them.
- Resolving a ticket resets the team's `helpType` to `fine` and clears `moderatorEnRoute`, since the ticket was the thing tracking that team's open need.
- DB enum columns are plain `text`, not Postgres enums — validated at the API boundary by the generated Zod schemas instead, to keep schema migrations simpler.

## Product

- **Room radar** (`/`) — every checked-in team as a card, color-coded by help status (fine/stuck/page now/do-not-disturb), plus a help queue of open tickets and room-wide counts.
- **Team dossier** (`/teams/:teamId`) — full ping timeline, phase/en-route controls, and ticket lifecycle (auto-draft with AI, edit, file to GitHub or Marshal-only, discard, resolve).
- **Check-in** (`/check-in`) — form for a team to register itself (name, table, what they're building, optional links).
- **Settings** (`/settings`) — set or clear the event end time shown as a countdown on the dashboard.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After editing `lib/api-spec/openapi.yaml`, always re-run codegen (`pnpm --filter @workspace/api-spec run codegen`) before touching routes or frontend hooks — route paths and Zod schema names come from the spec's `operationId`/paths, not from convention.
- `lib/api-client-react/tsconfig.json` needs `"dom.iterable"` in its `lib` array — Orval-generated client code calls `Headers.entries()`, which fails typecheck without it.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
