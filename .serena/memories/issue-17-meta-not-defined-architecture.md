# Architecture decision — issue #17 (meta is not defined)

**Decision:** Workflow sandbox treats `export const meta` as metadata only; it does NOT leave a runtime binding named `meta`. Runtime stamps/skew must use build-injected `const ENGINE_VERSION = '<plugin.json version>';` emitted after the meta literal by `scripts/build-workflows.mjs`.

**Layout:**
- `src/engine-version.mjs` — Node-only (`export const ENGINE_VERSION = meta.version`). NEVER add to ENTRIES[].modules.
- `state.mjs` / `main.mjs` — `import { ENGINE_VERSION } from './engine-version.mjs'` (stripped in dist).
- Dist: banner → export const meta → `const ENGINE_VERSION = '…';` → module bodies.
- Builder forbids `/\bmeta\./` in dist and registers ENGINE_VERSION in `seen`.

**Lockstep:** plugin.json / `// engine-version:` / meta.version remain the three markers; ENGINE_VERSION is a derived mirror.

Related: issue #17, mem:issue-17-meta-not-defined-gotchas.