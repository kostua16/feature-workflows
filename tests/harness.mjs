// Test harness: load the feature-pipeline engine's pure functions WITHOUT running
// the pipeline. The engine is a Workflow sandbox script — its body ends in
// `const final = await main()` / `return final`, so a normal ESM import would spawn
// agents (and `return final` is illegal at module top-level). We strip that tail,
// append an `export { ... }` for the unit-testable functions, and dynamic-import the
// transformed source. The transform mirrors the CI ESM check's `sed` neutralization.
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const enginePath = new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url)
const rawSrc = readFileSync(enginePath, 'utf8')

// Drop ONLY the two sandbox-execution tail lines; every function/const definition stays.
const stripped = rawSrc
  .split('\n')
  .filter((line) => {
    const t = line.trim()
    return t !== 'const final = await main()' && t !== 'return final'
  })
  .join('\n')

// Candidate names to expose for testing. A name is only added to the ESM
// `export {}` if the engine actually declares it (so the harness keeps working as
// functions are added/renamed, and a genuinely missing name surfaces in a test that
// reads `engine.<name>` as undefined rather than a hard load-time SyntaxError).
const CANDIDATES = [
  'resolveMode',
  'gateModeActive',
  'categorizeSlug',
  'taskSlug',
  'jiraIdFromTask',
  'detectNonEnglish',
  'invalidateStages',
  'extractJson',
  'clearGateAndDownstream',
  'LOOPBACK_FLAG_MAP',
  'writeChunkedFile',
  'detectTestCommand',
  'resolveProfile',
  'resolveUseTestWriter',
  'PROFILES',
  'hydrateBudget',
  'validatePipelineState',
  'stateChecksum',
  'verifyAppendGrowth',
  'detectOwnershipViolations',
  'normalizePath',
  'compactList',
  'consolidate',
  'retryState',
  'decisionState',
  'MODEL_DEFAULTS',
  'bumpGateTelemetry',
  'renderTelemetrySummary',
  'summarizeGates',
  'flushPipelineState',
  'detectResumeEngineSkew',
  'deriveNextCommand',
  'renderStatusReport',
  'selectBlockingFindings',
  'buildIssuesHandoff',
  'normalizeGateTarget',
  'resetStageForRerun',
  'applyApprovalDecision',
  'seedExtractQueue',
  'nextPendingSlice',
  'repairResumeArtifactFlags',
  'LIFECYCLE_STATES',
  'SKIP_REASONS',
  'TRANSITION_TABLE',
  'applyLifecycleEvent',
  'deriveReadiness',
  'isTerminal',
  'isIncomplete',
  'deriveFeatureId',
  'migrateLegacyState',
  'validateMigrationBoundary',
  'REVISION_INPUTS',
  'GATE_DEPENDENCY_MAP',
  'computeDigest',
  'computeContentDigest',
  'compareRevisions',
  'selectiveInvalidate',
  'retainValidEvidence',
  // Phase 2 — inventory, discovery, graph, queue, schedulability
  'PATH_POLICIES',
  'GENERATED_SEGMENTS',
  'IGNORE_SEGMENTS',
  'GENERATED_EXTENSIONS',
  'classifyPath',
  'buildInventory',
  'inventoryDigest',
  'refineOversizedArea',
  'createCursor',
  'nextPage',
  'resumeDiscovery',
  'exhausted',
  'allPages',
  'pageDigest',
  'extractFeaturesFromPages',
  'CYCLE_POLICIES',
  'GRAPH_VERDICTS',
  'canonicalizeIdentity',
  'detectCycle',
  'classifyCycle',
  'validateGraph',
  'graphDigest',
  'applyCap',
  'applySelector',
  'promoteDeferred',
  'queueDenominator',
  'segmentProgression',
  'SCHEDULABILITY_VERDICTS',
  'computeWaves',
  'boundedDependencyContext',
  'schedulabilityDecision',
  'SCOPE_VERDICT',
  'DECOMPOSE_VERDICT',
  'AUDIT_VERDICT',
  'OVERVIEW_VERDICT',
  'REVIEW_FINDINGS_VERDICT',
  'REVIEW_MERGE_VERDICT',
  'REVIEW_VERIFY_VERDICT',
  'REVIEW_LENSES',
  'SEVERITY_RANK',
  'meetsMinSeverity',
  'resolveMinSeverity',
  'resolveReviewLenses',
  'collectReviewDocs',
  'reviewIssueSection',
  'buildReviewReport',
]
const declared = CANDIDATES.filter((name) =>
  new RegExp(`\\b(?:function|const|let)\\s+${name}\\b`).test(stripped)
)
const src = `${stripped}\nexport { ${declared.join(', ')} }\n`

// Inert globals the engine reads lazily inside function bodies (never at load time
// once the `await main()` tail is stripped). Tests may override globalThis.agent.
globalThis.log = globalThis.log || (() => {})
globalThis.Workflow = globalThis.Workflow || (() => {})
if (!('args' in globalThis)) globalThis.args = {}
if (!('agent' in globalThis)) globalThis.agent = async () => ({})

const outPath = join(tmpdir(), `feature-pipeline.harness.${process.pid}.mjs`)
writeFileSync(outPath, src, 'utf8')

export const engine = await import(pathToFileURL(outPath).href)
