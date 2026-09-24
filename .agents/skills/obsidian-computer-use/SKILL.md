---
name: obsidian-computer-use
description: Launch an isolated Obsidian instance and test plugin behavior through screenshots, coordinate clicks, and keyboard input. Use for visual E2E verification and reproducing UI bugs; includes a launcher for the obsidian-plugins repository's Agent fixture.
---

# Obsidian Computer Use

Run the real packaged plugin in a disposable vault. Choose actions from screenshots and judge the visible result against the requested behavior. Use the repository's current written plan when one exists; otherwise use the user's stated expected behavior. Ask only for missing expectations that affect the verdict.

## Start a test instance

1. Inspect the repository's guidance, plugin manifest, build command, and existing desktop harness. Build the plugin being tested and record the revision and whether the working tree has changes.
2. Prefer the project's existing isolated launcher. Use separate temporary vault and application profile directories; copy the packaged `manifest.json`, `main.js`, and optional `styles.css` into `.obsidian/plugins/<manifest-id>/`. Seed fixture notes and deterministic service settings before launch. Keep personal vaults, credentials, and the user's running Obsidian session outside the test.
3. For the `obsidian-plugins` repository's Agent plugin, read [the repository launcher reference](references/repository-launcher.md) and run the bundled [session helper](scripts/session.mts). It reuses the existing Bubblewrap isolation, fresh vault/profile, and local model fixture. Its startup performs the harness's existing locale and trust setup; the interactive test begins with the emitted `ready` screenshot.
4. In another project, use its launcher or prepare a separate Obsidian profile with `--user-data-dir=<temporary-profile>` where supported by the installed executable. Open the disposable vault through that instance's vault picker. A global `obsidian://` URI may reach an existing session; verify the actual vault and window before proceeding. Follow any repository isolation requirements.
5. Discover the available computer-use tools. Prefer a desktop tool that captures screenshots and sends coordinate mouse/keyboard input. If unavailable, the bundled session helper supplies renderer screenshots and coordinate input through Playwright CDP. This fallback covers Obsidian's app content; native file dialogs, title bars, and other OS windows require a desktop tool. If neither route is available, report the missing capability and the unperformed test.

## Observe, act, verify

- View the first screenshot and confirm the test vault and intended app surface. Saving a screenshot without viewing it is not observation.
- Identify the next target from the current image. Click, type, press a shortcut, scroll, or drag through the selected input tool. Avoid DOM selectors, accessibility-tree locators, JavaScript evaluation, plugin methods, or direct file writes to perform the behavior under test. Fixture setup and subsequent file inspection can support the test; record them separately.
- After an action changes focus, layout, scroll position, or window state, inspect a fresh screenshot before choosing the next target. Reuse coordinates only while the visible layout is unchanged. A short sequence such as focusing a field and typing into it can share one observation.
- Keep the capture and input coordinate systems consistent. Desktop tools may use screen pixels or logical coordinates. The helper uses an uncropped viewport screenshot at CSS scale, matching its mouse coordinates. If the image viewer scales the image, map coordinates back to the image's reported dimensions. Do not derive clicks from a full-page image or cropped image without accounting for its offset.
- Wait for a specific visible result using fresh screenshots and a bounded deadline appropriate to the action. A successful input command or an elapsed delay does not establish success. When a click appears ineffective, inspect focus, overlays, and loading state before retrying; avoid repeating actions that can create duplicate effects.
- For text entry, confirm the field has focus. Use real key presses when testing shortcuts, submission, key handling, or navigation; inserting text alone does not exercise those events.

## Judge the behavior

State the expected result before exercising each scenario. Cover the requested success path and relevant failure or boundary behavior. Include persistence, cancellation, reload, or disabling/re-enabling the plugin when the requirement depends on those boundaries. For lifecycle checks, the helper's `reload` operation reloads the renderer explicitly; verify restoration from fresh screenshots. Test a reload shortcut separately if that shortcut is part of the requirement.

Check the visible result and, when relevant, the resulting files in the disposable vault. Keep an initial screenshot, decisive screenshots, and failure evidence. Record expected versus observed behavior and classify each scenario as passed, failed, or blocked. A screenshot of an open sidebar does not prove that sending a message, saving a setting, or editing a note works.

The bundled fixture returns deterministic model output; it cannot establish real provider availability or authentication. Existing automated E2E results and a visual computer-use run are distinct evidence. Preserve the repository's required automated regression checks when delivering a code change.

## Finish

End the helper with an explicit verdict or close only the test instance and services you started. Preserve evidence outside temporary profile directories before cleanup. Never terminate every Obsidian process. Report the tested revision/build, scenarios and verdicts, evidence paths, fixture limitations, and any blocked checks. Keep the report proportional to the task.
