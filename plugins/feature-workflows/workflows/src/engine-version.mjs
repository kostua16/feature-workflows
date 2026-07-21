// Node-only helper: MUST NOT be added to ENTRIES[].modules in build-workflows.mjs.
// The dist gets `const ENGINE_VERSION = '<plugin.json version>';` injected after
// `export const meta` (Workflow sandbox does not bind `meta` at runtime — issue #17).
// Source meta.version may be the placeholder `0.0.0-dev`; production uses the injected literal.
import { meta } from './meta/feature-pipeline.meta.mjs'
export const ENGINE_VERSION = meta.version
