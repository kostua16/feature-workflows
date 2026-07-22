export const meta = {
  name: 'fp-extract-slice',
  version: '0.0.0-dev', // injected from plugin.json by scripts/build-workflows.mjs
  description: 'Leaf workflow: extract design docs for one admitted feature through the per-slice extraction gates (code facts, e2e use cases, detailed design, architecture, fidelity reviews, requirements, audit). Processes exactly one feature; the top-level pipeline retains discovery, scheduling, synthesis, continuation, and readiness authority.',
  phases: [
    { title: 'Extract Slice' },
    { title: 'Design Audit' },
  ],
}
