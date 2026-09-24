---
name: update-project-docs
description: Reconcile AGENTS.md and README.md with project skills, plans, and recent changes. Use when maintaining repository guidance or user documentation, or when a repository change makes either document stale.
---

# Update Project Docs

Keep AGENTS.md and README.md concise, with references to maintained skills or other docs for detail. Give each document a `Last updated at` commit marker.

## Establish what changed

Read both documents and their revision markers. Review project skills under `.agents/skills/`, relevant plans under `docs/`, recent commits, and the working-tree diff. Use each valid marker to compare changes since that document was last reviewed; if it is missing or unavailable in local history, review the relevant history and files directly.

Skills describe how contributors work; plans describe intended behavior. Confirm claims about available features, installation, commands, and support against the implementation, manifests, and configuration. Do not present a proposal or an old verification record as a shipped feature or a new passing check. Preserve unrelated work already in progress.

## AGENTS.md: durable guidance

Keep only common knowledge that remains useful across ordinary project changes and short references to the skills that own the work.

- Move workflows, procedures, checklists, and reusable task instructions into the appropriate project skill. Replace them with a brief reference, preserving the original requirements in the destination.
- Remove snapshots of code or documentation: directory inventories, current architecture, tool versions, feature status, and descriptions of what files currently contain.
- Prefer an existing skill over a duplicate. If a new skill is needed, keep it scoped to the extracted task. Repair references affected by the move, including skills that previously sent readers to AGENTS.md or README.md for those details.

## README.md: potential users

Explain what the project does, who can use it, and the shortest supported path to getting started. Mention only the capabilities and limitations that help someone decide whether to use it.

Link to setup details, contributor guidance, or specialist docs when needed. Keep implementation inventories, internal verification procedures, CI tuning, exhaustive configuration options, and plan-by-plan history out of the README. Retain useful detail in its owning skill or supporting doc rather than copying it across documents. Do not invent release downloads or installation channels.

## Revision markers and review

Use a footer in each document: ``Last updated at: `<full commit hash>`.`` Resolve the hash with `git rev-parse HEAD` after reviewing that revision. It records the project revision reviewed, not the commit containing the documentation edit; do not amend repeatedly to chase a self-referential hash. When including current working-tree changes, retain this committed baseline and identify those changes in the delivery summary. Never advance a marker past changes actually reviewed.

Check local links, commands, feature claims, formatting, and preservation of extracted requirements. Confirm both documents serve their intended readers without duplicating the skills. For documentation-only changes, use document and skill validation; plugin behavior changes follow [Land Changes](../land-changes/SKILL.md). Report the documents updated, the reviewed revision, and any unresolved discrepancies.
