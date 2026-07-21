# Reference: `ENGINE_VERSION` build injection

**Purpose:** Concrete emit shape for the issue #17 fix so src, dist, and Node tests stay consistent.

## Single source of truth

`plugins/feature-workflows/.claude-plugin/plugin.json` → `version`

Build already injects that value into:

1. `// engine-version: ${version}` banner line
2. `version: '${version}',` inside `export const meta`

Add a third injection (runtime-safe):

3. `const ENGINE_VERSION = '${version}';` immediately after the meta literal

`validate:versions` remains a **three-way** lockstep (plugin.json / header / `meta.version`). `ENGINE_VERSION` is a derived mirror enforced by the builder + dist tests, not a fourth hand-edited site.

## Recommended source layout

### New module (Node-only import; not concatenated)

`plugins/feature-workflows/workflows/src/engine-version.mjs`:

```js
import { meta } from './meta/feature-pipeline.meta.mjs'
export const ENGINE_VERSION = meta.version
```

**Do not** add this file to `ENTRIES[].modules` in `build-workflows.mjs`.

### Consumers

`state.mjs` / `main.mjs`:

```js
import { ENGINE_VERSION } from './engine-version.mjs'
// …
engineVersion: ENGINE_VERSION,
// …
resumed.engineVersion !== ENGINE_VERSION
```

Under Node: real ESM import resolves.

Under dist: import lines are stripped; the injected `const ENGINE_VERSION = '…'` supplies the binding for all following function bodies.

## Builder snippet (conceptual)

```js
const engineVersionDecl = `const ENGINE_VERSION = '${version}';`
const dist = [
  entry.banner.join('\n'),
  '',
  metaSrc,
  '',
  engineVersionDecl,
  '',
  bodies.join('\n\n'),
  '',
  'const final = await main()',
  'return final',
  '',
].join('\n')

if (!dist.includes(engineVersionDecl)) {
  throw new Error(`${entry.out}: ENGINE_VERSION injection missing`)
}

// Whole-dist scan is enough: `export const meta =` does not match `\bmeta\.`
if (/\bmeta\./.test(dist)) {
  throw new Error(`${entry.out}: forbidden runtime meta. access (sandbox does not bind meta; issue #17)`)
}

// Before module DECL_RE scan:
seen.set('ENGINE_VERSION', '<injected>')
```

## Self-check intent

| Check | Purpose |
|---|---|
| `const ENGINE_VERSION = '<version>'` present | Injection succeeded |
| No `\bmeta\.` in dist | Sandbox-safe runtime (do **not** ban bare `\bmeta\b`) |
| `ENGINE_VERSION` in `seen` | Clear error if a module redeclares it |
| Existing forbidden tokens | Unchanged sandbox hygiene |
| `build-drift` / `validate:build` | Committed dist matches builder |

## Non-goals

- Do not polyfill `meta` as `globalThis.meta = …`
- Do not use dynamic `import()` or `globalThis.ENGINE_VERSION` in concatenated bodies
- Do not remove `export const meta`
- Do not teach `validate:versions` a fourth manual field
- Do not add `engine-version.mjs` to `modules[]`
