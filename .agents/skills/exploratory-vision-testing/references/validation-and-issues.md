# Independent validation and GitHub filing

Read after extensive exploration, when candidate bugs have been recorded in the temporary `bugs.md`. Observation labels such as Confirmed or Observed once are not independent validation verdicts.

## One validator per bug

Deduplicate identical findings, then spawn one fresh subagent for each remaining candidate bug. Use `fork_turns: "none"` where supported. Give each agent only its bug record, original screenshots/transcript, tested build and fixture recipe, relevant written requirements, repository guidance, and the project-local computer-use skill. Include source paths so the validator can check expectations independently; omit the explorer's proposed root cause or fix. Do not ask the validator to agree with the original conclusion.

Use a bounded task such as:

> Independently determine whether BUG-001 is a product defect. Read the supplied contract and evidence, inspect the actual screenshots, and reproduce through screenshot-guided input in a separate disposable vault/profile when feasible. Distinguish product behavior from fixture limitations and unsupported expectations. Do not edit plugin code, modify the shared bugs.md, or publish issues. Write your result to the assigned temporary validation path: Valid, Invalid, or Inconclusive; oracle; observed evidence; reproduction frequency; screenshot paths; impact; and remaining limitations. Stop after three non-converging diagnostic passes.

Give each validator its own `validation/BUG-001.md` output and evidence directory. Queue distinct agents in batches if slots are limited. Keep vaults and profiles separate. Each harness process starts its own private headless compositor, so parallel validators cannot steal focus from one another or resize another session's window, and the interactive portions do not need serializing. Confirm each session reports the expected fixed viewport before trusting coordinates taken from its screenshots. The parent alone merges results into `bugs.md`.

- **Valid:** Independently established contradiction of a supported expectation, using a fresh reproduction or decisive inspected original evidence. For intermittent findings, state whether the validator reproduced it or validated only the captured occurrence; a passing retry alone does not refute it.
- **Invalid:** Evidence establishes expected behavior, a mistaken observation, or an environment/fixture cause rather than a product defect. Explain the evidence; do not use failure to reproduce as the sole reason.
- **Inconclusive:** Missing evidence, unclear oracle, unavailable fixture, or unsuccessful reproduction without decisive original evidence. State exactly what is missing and retain the finding.

One agent reviews one candidate bug. If it discovers a different defect, the parent assigns a new bug ID and another validator. If delegation is unavailable, mark validation pending; the explorer cannot substitute its own judgment. Every candidate needs a recorded disposition, including rejected findings.

## Prepare validated issues

The parent files issues only for Valid findings with a relevant, inspected screenshot. Use an existing original screenshot when it demonstrates the bug, or the validator's reproduction capture. A generic open-window screenshot does not substantiate a defect. If evidence is missing, keep the valid bug pending screenshot capture. Use synthetic test data and exclude credentials or unrelated private content from uploads.

An explicit invocation of the full skill includes issue filing; do not request redundant approval. Honor an explicit local-only/dry-run request. If the skill was selected implicitly and issue publication was not requested, prepare the validated bodies and screenshots before seeking that missing authorization.

Resolve the intended GitHub repository from the user's target and checkout remotes. Check `gh repo view --json nameWithOwner,url`, `gh auth status`, and `gh issue create --help` without exposing credentials. Use explicit `--repo OWNER/REPO` on issue operations. An ambiguous target or missing authentication is a filing blocker; do not guess another repository or alter account configuration.

Before each creation, search existing open and closed issues for the same behavior with `gh issue list --repo OWNER/REPO --state all --search 'distinctive terms' --json number,title,url,state,body`. Inspect plausible matches. Link an existing same-defect issue in `bugs.md` rather than creating a duplicate. A closed issue is not automatically a duplicate if the tested build demonstrates a later regression; state that relationship when filing a new regression issue.

Write each complete issue body to `issues/BUG-001.md` inside the temporary run folder. Include the observed failure, affected build/environment, minimal UI reproduction steps, expected and actual behavior, oracle, impact/severity, reproduction count, independent validation result and limitations. Make the issue understandable without access to local files. Omit local-only Markdown links and embed relevant evidence text. Use the repository's issue template fields when present. Add labels only if applicable labels already exist.

## Create with an actual screenshot attachment

Check `gh issue create --help` for `--attach` support in the current environment. When supported, the CLI uploads the image and appends it to the issue body, or replaces a matching local image reference already in that body. Do not substitute a local filesystem path or a `file://` link for an uploaded screenshot. Do not commit evidence or create branches, gists, or releases merely to host images.

Adapt this example with actual values and safely quoted arguments:

```bash
gh issue create --repo OWNER/REPO \
  --title 'Prefix setting disappears after reload' \
  --body-file '/tmp/exploratory-vision-testing.RUN/issues/BUG-001.md' \
  --attach '/tmp/exploratory-vision-testing.RUN/evidence/BUG-001.png#Prefix is blank after reload'
```

Use `--body-file` to preserve multiline text. Save stdout, stderr, exit status, and any issue URL immediately. Then fetch the created issue with `gh issue view ISSUE_URL --repo OWNER/REPO --json url,title,body` and confirm the intended body and an uploaded image URL are present. Verify the linked image is retrievable and matches the reviewed screenshot using authorized access where needed. Record the issue URL and attachment verification in `bugs.md`.

If this `gh` version lacks attachment support or uploading is unavailable, keep the validated body and screenshot ready and mark filing blocked. Do not silently create an issue without the required screenshot.

## Partial success and retries

An attachment failure can still leave a created issue and a printed URL even when the command exits nonzero. A timeout can also leave the outcome uncertain. Read stdout and query the target repository for the matching title/body before retrying. Do not issue a second create while the first outcome is unresolved. Use **Created — attachment pending** when the issue exists without its required screenshot, and retain its URL and repair-attempt count.

When the issue exists but its required screenshot is missing, repair that same issue with `gh issue edit ISSUE_URL --repo OWNER/REPO --attach '/tmp/.../BUG-001.png#Failure state'` after checking the command's help. Fetch it again and verify the attachment. Allow one targeted repair/retry after addressing the reported cause; if it still fails, retain the issue URL, error, and pending attachment status for the user. Never report screenshot filing complete merely because an issue URL exists.

References: [GitHub CLI issue creation](https://cli.github.com/manual/gh_issue_create), [issue editing](https://cli.github.com/manual/gh_issue_edit), and [GitHub attachment behavior](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
