The plan's central path derivation has an unresolved bootstrap dependency, and the proposed update flow cannot detect newly added files or rerun gates while existing artifact guards remain populated. Its path and content digest definitions also do not provide the claimed stability or collision safety.

Full review comments:

- [P1] Define a bootstrap location before deriving planDir — /Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:26-26
  The final path cannot currently be derived from the resolved scope because `main.mjs` creates `planDir` before `resolveScope({ task, planDir, result })`, and that resolver writes `scope-manifest.md` under the provided directory. Scope confirmation can also replace `scopeFiles` on a later resume. Specify a write-free preflight resolver or a temporary directory plus relocation strategy; otherwise the implementation must hash an unconfirmed scope or persist artifacts under the wrong path.

- [P1] Make primary-slug independent of mutable reference counts — /Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:32-32
  `primary-slug` is part of the folder path, but “most-referenced” is neither defined by the current scope schema nor stable when source references change. The same resolved file set could therefore acquire a different folder after an ordinary content change, despite the stated path-hash/content-digest separation. Derive it from a fully specified stable ordering of normalized identity inputs.

- [P1] Rediscover membership before hashing persisted slices — /Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:44-47
  On resume, recomputing a digest from each persisted `slice.files` list cannot detect newly added files because those paths are absent from the list being hashed. Supporting the promised added-file behavior requires rerunning scope inventory and reconciling membership and slice ownership before digest comparison; otherwise additions are silently treated as unchanged.

- [P1] Reset artifact guards when invalidating a slice — /Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:46-46
  Extraction gates do not consult acknowledgements to decide whether to run: `extractSlice` checks fields such as `factsPath`, `useCasePath`, `designPath`, `archPath`, and review flags, which are reconstructed from `slice.artifacts`. Clearing only gate acknowledgements would therefore skip every gate and mark the changed slice complete again. Invalidation must reset the slice status and all relevant artifact-path and review guards.

- [P2] Hash repository-relative paths instead of realpaths — /Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:28-28
  When the same repository is checked out in a different clone or worktree, canonical `realpath` values contain a different absolute root and produce a different `scopeHash8`. That violates deterministic feature mapping across environments. Normalize symlinks as needed, but hash stable repository-relative POSIX paths rather than absolute realpaths.

- [P2] Frame each file in the source digest — /Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:42-42
  Hashing concatenated contents is ambiguous: different memberships such as contents `["ab", "c"]` and `["a", "bc"]`, or a rename retaining identical bytes, produce the same input. This contradicts the claim that membership changes always alter the digest. Hash normalized path plus content length and content for each sorted file, or hash a canonical structured array.

- [P2] Replace the 32-bit folder hash — /Users/kostua16/Documents/Projects/feature-workflows/.claude/worktrees/ver1.5.0/plans/260723-extract-deterministic-folders-upsert/plan.md:33-33
  `computeContentDigest` uses 32-bit djb2 and returns an unpadded hexadecimal string, so it neither provides collision resistance nor consistently produces eight characters. Two distinct scopes with the same area and primary slug can therefore share an upsert directory and overwrite each other's documentation. Use a fixed-length prefix of a stronger digest suitable for persistent identity.
