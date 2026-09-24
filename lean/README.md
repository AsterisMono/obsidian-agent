# Shared proof tooling

The agent plugin has one Lean project, configured by the plugin-root `lakefile.toml`, `lake-manifest.json`, and `lean-toolchain`. Each plan keeps its proof sources at `docs/<plan-stem>/lean/` and declares a distinct library namespace such as `Plan0002`.

[ProofAudit.lean](ProofAudit.lean) implements the common axiom allowlist. Each plan lists its own theorem names explicitly; the shared TypeScript check runner builds every plan library, runs its audit, and checks its generated model cases and provenance.

The planner authors and checks these artifacts before feature implementation. See [0002's verification evidence](../docs/0002-formal-verification/0002-formal-verification.md#current-lean-evidence) for the initial models and their limits. Run `pnpm check:lean` from the repository root inside `devenv shell`.
