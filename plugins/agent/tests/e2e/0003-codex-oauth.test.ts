import assert from 'node:assert/strict';
import test from 'node:test';
import type { Locator, Page } from 'playwright-core';
import { withAgent } from './support.ts';

function settingRow(settings: Locator, name: string): Locator {
  return settings.locator('.setting-item').filter({ hasText: name }).first();
}

async function openAgentSettings(page: Page): Promise<{ page: Page; settings: Locator }> {
  await page.locator('.clickable-icon:has(svg.lucide-settings)').click();
  const settingsPage = page
    .context()
    .pages()
    .find((item) => item !== page);
  assert.ok(settingsPage, 'Obsidian did not open its Settings window.');
  await settingsPage
    .locator('.vertical-tab-nav-item')
    .filter({ hasText: 'Obsidian Agent' })
    .click();
  const settings = settingsPage.locator('.vertical-tab-content');
  await settings.getByRole('heading', { name: 'Obsidian Agent' }).waitFor();
  return { page: settingsPage, settings };
}

async function assertNoEndsWithNotice(pages: Page[]): Promise<void> {
  const noticeTexts = (
    await Promise.all(pages.map((page) => page.locator('.notice').allTextContents()))
  ).flat();
  assert.doesNotMatch(noticeTexts.join('\n'), /endsWith/i);
}

await test('OpenAI Codex OAuth offers browser and device-code login without a loader error', async () => {
  await withAgent('codex-oauth', async (agent) => {
    const { page: settingsPage, settings } = await openAgentSettings(agent.page);
    await settingRow(settings, 'Provider')
      .locator('select:not([aria-hidden])')
      .selectOption('openai-codex');
    await settingRow(settings, 'API key').getByRole('button', { name: 'OAuth login' }).click();

    const prompt = settingsPage.locator('.agent-login-prompt');
    await prompt.getByText('Select OpenAI Codex login method:', { exact: true }).waitFor();
    const choices = await prompt.locator('select option').evaluateAll((options) =>
      options.map((option) => ({
        id: option.getAttribute('value'),
        label: option.textContent,
      })),
    );
    assert.deepEqual(choices, [
      { id: 'browser', label: 'Browser login (default)' },
      { id: 'device_code', label: 'Device code login (headless)' },
    ]);
    await assertNoEndsWithNotice(agent.page.context().pages());

    await settingsPage.keyboard.press('Escape');
    await prompt.waitFor({ state: 'detached' });
    await settingsPage
      .locator('.notice')
      .filter({ hasText: 'Login cancelled.' })
      .waitFor({ timeout: 10000 });
    await assertNoEndsWithNotice(agent.page.context().pages());
  });
});
