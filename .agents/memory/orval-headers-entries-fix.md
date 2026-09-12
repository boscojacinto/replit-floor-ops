---
name: Orval codegen dom.iterable fix
description: Orval-generated React Query client code calls Headers.entries(), which fails typecheck without dom.iterable in tsconfig lib.
---

Orval's generated fetch-based client code (in the `lib/api-client-react`-style generated package) iterates over a `Headers` object with `.entries()`. TypeScript rejects this at compile time unless the consuming package's `tsconfig.json` includes `"dom.iterable"` in its `compilerOptions.lib` array — `"dom"` alone is not enough.

**Why:** This surfaced as a typecheck failure right after running `pnpm --filter @workspace/api-spec run codegen` for the first time in a project, with no other code changes. It looks like a codegen bug but is actually a pre-existing tsconfig gap that only matters once generated code exercises `Headers` iteration.

**How to apply:** If a fresh Orval codegen run breaks typecheck on `Headers.entries()` (or similar DOM iterable APIs) in the generated client package, add `"dom.iterable"` to that package's `tsconfig.json` `lib` array rather than editing the generated file — the fix is durable across future codegen runs, editing generated output is not.
