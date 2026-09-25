# Tooling and proof checks

Use this reference when implementing a proof task. Writing an adoption plan alone does not require toolchain installation.

## Repository integration

Check for existing Lean configuration before creating a project. Each plan's models live in `docs/<codename>-<feature-slug>/lean/` with the shared Lake project at the repository root, and shared proof tooling lives in `lean/`. Use `Plan` followed by the full stem in PascalCase for both the namespace and Lake library target, such as `PlanSteadyFalconFormalVerification`. Register the target's `srcDir` in `lakefile.toml`; `scripts/check-lean.ts` discovers folders with Lean sources and checks their matching plan, library root, audit, and fixtures. Plans use codename folders, never numbered names.

For a new model, start with Lean's bundled libraries. Add Mathlib only when the selected theorem needs it. Pin a concrete Lean 4 version in `lean-toolchain`, retain the Lake configuration and generated dependency manifest, and ignore `.lake/` build artifacts. Confirm command availability against that version rather than assuming the moving `latest` documentation matches it.

Provision missing tooling through [Devenv Dependencies](../../devenv-dependencies/SKILL.md). Inspect the available Nix packages and choose a consistent pinned Lean/Lake setup, or an explicitly managed Elan setup. Verify the actual version inside `devenv shell`; a `lean-toolchain` file alone does not prove the executable honors it. Avoid undeclared global installers.

Keep proof commands in the root `package.json`. `pnpm check:lean` runs the shared checker and is included in `pnpm check`, alongside formatting, lint, TypeScript, and ActionLint. Keep the proof project outside the esbuild runtime import graph and the packaged plugin files.

Ensure the build target imports every claimed theorem and its axiom audit. A successful build of an empty library or only an executable does not check an unreferenced proof file. Fresh verification should rebuild affected sources and reproduce any generated model fixtures. For an established project, commands typically take this form from the proof directory:

```sh
lake --version
lake env lean --version
lake --wfail build
```

Lake's `--wfail` makes logged warnings fail the build. Check the actual target graph and the pinned toolchain's supported flags. Preserve lockfiles; routine proof checks should not update dependencies. See the [Lake manual](https://lean-lang.org/doc/reference/latest/Build-Tools-and-Distribution/Lake/).

## Proof integrity

Review the requirement and theorem statement before accepting proof success. Check reachable initial states, meaningful preconditions, success as well as rejection, and the definitions appearing in the statement. A complete proof of an irrelevant statement cannot establish the requested behavior.

Require completed proofs for claimed properties. Use `#print axioms Namespace.theoremName` for each public correctness claim to inspect transitive dependencies. Standard logical axioms such as `propext`, `Classical.choice`, and `Quot.sound` are expected when used; `sorryAx` and custom assumptions are not evidence of completed verification. Treat intentional environment assumptions as explicit hypotheses and report their scope.

Keep warning reporting enabled, and reject `sorry`/`admit` in completed proof work. Source searches are a useful check but do not replace the transitive axiom audit. Prefer tactics that produce ordinary kernel-checked proofs. If `native_decide` or other native evaluation is used, inspect its compiler-trust dependencies for the pinned Lean version and disclose that larger trust boundary. A successful `#eval` checks a concrete execution, not a universal theorem. These distinctions follow Lean's [proof validation guidance](https://lean-lang.org/doc/reference/latest/ValidatingProofs/).

For an automated gate, explicitly check the reported axiom set against the accepted logical axioms and make disallowed dependencies fail. Merely printing axioms exits successfully even when unwanted axioms are present. Keep the claimed theorem list explicit so a renamed or dropped theorem cannot silently disappear from the audit. Use stronger external proof checkers only when the task's trust requirements justify them.

Do not bypass kernel checking, replace the implementation with an unproved axiom, suppress diagnostics, or relabel an unchecked sketch as a result to make a gate pass. If the environment cannot run the checker, report that limit and retain the concrete proof obligations.

## Model-to-implementation checks

Write down the representation mapping. Lean strings use Unicode text with UTF-8 storage, whereas JavaScript strings operate on UTF-16 code units and can contain lone surrogates. Matching names such as `length` or `slice` are insufficient evidence of matching semantics. Model the relevant units, or validate a restricted domain. See [Lean strings](https://lean-lang.org/functional_programming_in_lean/Getting-to-Know-Lean/Characters___-Strings___-and-Slices/) and the [ECMAScript string definition](https://tc39.es/ecma262/2024/#sec-ecmascript-language-types-string-type).

Similarly, an unbounded Lean `Nat` or `Int` does not match arbitrary JavaScript `number`. Model representable bounds, rounding, exceptional values, and arithmetic as relevant to the property, or establish guards that exclude them. An opaque content value is sufficient for an equality-only guard if its encoding preserves and reflects the equality used by TypeScript.

Have the executable model produce the oracle from independently specified semantics. Check concrete valid and invalid examples against the written requirements before generating a larger corpus. Compare outcomes and externally visible state, including error paths, through the existing E2E harness. Add the concrete input or event trace whenever modeling discovers a bug; retain deterministic inputs or seeds and model provenance.

This approach adapts Cedar's use of a Lean specification plus differential testing to this repository's E2E-only feature testing policy. Cedar's [specification repository](https://github.com/cedar-policy/cedar-spec) documents the separation between formalization and production implementation. It is a precedent for the workflow, not evidence that this plugin has been verified.

After plugin changes, run the checks required by the E2E and plugin development skills, including proof checks, type/lint/format checks, the bundle build, and affected desktop E2E scenarios. Record skipped checks accurately. Keep evidence distinct: a proved model property, a sampled implementation comparison, and an assumed external API contract establish different things.
