import assert from 'node:assert/strict';
import test from 'node:test';
import type { App } from 'obsidian';
import type { Locator, Page } from 'playwright-core';
import { withAgent, type ModelRequest, type ModelStream } from './support.ts';

declare global {
  interface Window {
    app: App;
  }
}

async function waitFor(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function latestUser(request: ModelRequest): string {
  const message = [...request.messages].reverse().find((item) => item.role === 'user');
  assert.ok(message, 'The model request has no user message.');
  return JSON.stringify(message.content);
}

function reply(stream: ModelStream, content: string): void {
  stream.chunk({ role: 'assistant', content });
  stream.finish();
}

async function assertResponsiveTheme(page: Page, view: Locator): Promise<void> {
  const colors: string[] = [];
  for (const theme of ['light', 'dark']) {
    const color = await page.evaluate((selected) => {
      document.body.classList.remove('theme-light', 'theme-dark');
      document.body.classList.add(`theme-${selected}`);
      const element = document.querySelector('.agent-view');
      if (!(element instanceof HTMLElement)) throw new Error('Agent view is absent.');
      return getComputedStyle(element).color;
    }, theme);
    colors.push(color);
    assert.match(color, /^rgb\(/);
  }
  assert.notEqual(colors[0], colors[1], 'Agent text did not follow the host theme.');
  const size = await view.evaluate((element) => {
    const split = element.closest('.workspace-split.mod-right-split');
    if (!(split instanceof HTMLElement)) throw new Error('Right sidebar split is absent.');
    split.style.width = '260px';
    split.style.minWidth = '260px';
    split.style.maxWidth = '260px';
    split.style.flexBasis = '260px';
    return new Promise<{ width: number; overflow: number; controls: number; clipped: string[] }>(
      (resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const root = element.getBoundingClientRect();
            const clipped: string[] = [];
            let controls = 0;
            for (const control of Array.from(
              element.querySelectorAll('button, select, textarea, input'),
            )) {
              const bounds = control.getBoundingClientRect();
              if (bounds.width < 1 || bounds.height < 1) continue;
              controls += 1;
              const label =
                control.getAttribute('aria-label') || control.textContent.trim() || control.tagName;
              if (bounds.left < root.left - 1 || bounds.right > root.right + 1) {
                clipped.push(label);
                continue;
              }
              let ancestor = control.parentElement;
              while (ancestor && ancestor !== element.parentElement) {
                const overflow = getComputedStyle(ancestor).overflowX;
                if (['hidden', 'clip', 'auto', 'scroll'].includes(overflow)) {
                  const boundary = ancestor.getBoundingClientRect();
                  if (bounds.left < boundary.left - 1 || bounds.right > boundary.right + 1) {
                    clipped.push(label);
                    break;
                  }
                }
                ancestor = ancestor.parentElement;
              }
            }
            resolve({
              width: element.getBoundingClientRect().width,
              overflow: element.scrollWidth - element.clientWidth,
              controls,
              clipped,
            });
          });
        });
      },
    );
  });
  assert.ok(size.width <= 261, `The sidebar did not narrow to 260 px: ${String(size.width)}.`);
  assert.ok(size.overflow <= 1, `The sidebar overflows by ${String(size.overflow)} px.`);
  assert.ok(size.controls >= 6, 'The narrow sidebar is missing expected controls.');
  assert.deepEqual(size.clipped, [], 'Narrow sidebar controls are horizontally clipped.');
}

async function closeSidebar(page: Page): Promise<void> {
  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeavesOfType('agent-chat').at(0);
    if (leaf === undefined) throw new Error('Agent sidebar leaf is absent.');
    leaf.detach();
  });
  await page.locator('.agent-view').waitFor({ state: 'detached' });
}

await test('React chat sidebar preserves live drafts, chat history, run state, and narrow themed layout', async () => {
  let releaseFirst: (() => void) | undefined;
  let releaseDelayedError: (() => void) | undefined;
  let stopClosed = false;
  let switchClosed = false;
  let newChatClosed = false;
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const delayedErrorHeld = new Promise<void>((resolve) => {
    releaseDelayedError = resolve;
  });
  const seeded = {
    activeChatId: 'empty',
    thinking: 'medium',
    chats: [
      {
        id: 'older',
        title: 'Older project',
        messages: [{ role: 'user', content: 'Older saved message', timestamp: 1 }],
        pending: false,
        interrupted: false,
        interruptedText: '',
        activity: [],
        updatedAt: 10,
      },
      {
        id: 'empty',
        title: 'Empty chat',
        messages: [],
        pending: false,
        interrupted: false,
        interruptedText: '',
        activity: [],
        updatedAt: 20,
      },
      {
        id: 'newer',
        title: 'Newest project',
        messages: [{ role: 'user', content: 'Rendered <b>as text</b>', timestamp: 2 }],
        pending: false,
        interrupted: false,
        interruptedText: '',
        activity: ['Saved activity'],
        updatedAt: 30,
      },
    ],
  };
  try {
    await withAgent(
      'react-sidebar',
      async (agent) => {
        await agent.openSidebar();
        const view = agent.view();
        const composer = view.getByRole('textbox', { name: 'Message' });
        const model = view.getByRole('combobox', { name: 'Model' });
        const thinking = view.getByRole('combobox', { name: 'Thinking' });
        const emptyState = view.locator('.agent-empty-state');
        await emptyState.waitFor();
        assert.ok((await emptyState.innerText()).trim().length > 0);
        assert.equal(await view.getByText('Older saved message').count(), 0);
        assert.equal(await view.getByText('Rendered <b>as text</b>', { exact: true }).count(), 0);
        assert.equal(await view.getByRole('button', { name: 'Send' }).isVisible(), true);
        assert.equal(await thinking.inputValue(), 'medium');
        assert.equal(
          await view.getByRole('button', { name: /source|command|dictation/i }).count(),
          0,
        );

        await view.getByRole('button', { name: 'Saved chats' }).click();
        const savedButtons = view.locator('button[data-chat-id]');
        assert.deepEqual(
          await savedButtons.evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute('data-chat-id')),
          ),
          ['newer', 'empty', 'older'],
        );
        const search = view.getByRole('searchbox', { name: 'Search chats' });
        await search.fill('nEwEsT');
        assert.deepEqual(
          await savedButtons.evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute('data-chat-id')),
          ),
          ['newer'],
        );
        await search.fill('no matching title');
        assert.equal(await savedButtons.count(), 0);
        await view.locator('.agent-saved-empty').getByText('No matching chats').waitFor();
        await search.fill('');
        await view.locator('button[data-chat-id="newer"]').click();
        const literal = view.getByText('Rendered <b>as text</b>', { exact: true });
        await literal.waitFor();
        assert.equal(await literal.locator('b').count(), 0);
        await view.locator('.agent-tool-activity').getByText('Saved activity').waitFor();
        if (await search.isVisible())
          await view.getByRole('button', { name: 'Saved chats' }).click();
        await search.waitFor({ state: 'detached' });

        await agent.newChat();
        assert.equal(await view.getByText('Rendered <b>as text</b>', { exact: true }).count(), 0);
        await composer.fill('Please summarize');
        await model.selectOption('custom-fixture::fixture-alternate');
        await thinking.selectOption('high');
        assert.equal(await composer.inputValue(), 'Please summarize');
        await waitFor(
          () =>
            agent.savedData().model === 'custom-fixture::fixture-alternate' &&
            agent.savedData().thinking === 'high',
          'model and thinking selections to persist',
        );

        await view.getByRole('button', { name: 'Attach active note' }).click();
        await view
          .locator('.agent-error')
          .getByText('Open a Markdown note before attaching it.')
          .waitFor();
        assert.equal(await composer.inputValue(), 'Please summarize');
        await agent.page.locator('.nav-file-title[data-path="Welcome.md"]').first().click();
        await view.getByRole('button', { name: 'Attach active note' }).click();
        await view.getByText('Welcome.md', { exact: true }).waitFor();
        assert.equal(await composer.inputValue(), 'Please summarize');
        await composer.press('Enter');
        await view.getByText('Stream <em>partial</em>', { exact: true }).waitFor();
        assert.equal(await view.getByRole('button', { name: 'Stop' }).isVisible(), true);
        assert.equal(await view.getByRole('button', { name: 'Send' }).count(), 0);
        assert.equal(await model.isDisabled(), true);
        assert.equal(await thinking.isDisabled(), true);
        assert.equal(await composer.inputValue(), '');
        assert.match(JSON.stringify(agent.requests[0]?.messages), /Fixture note content/);
        assert.equal(agent.requests[0]?.model, 'fixture-alternate');
        assert.equal(agent.requests[0]?.stream, true);
        await composer.fill('Later draft');
        assert.ok(releaseFirst, 'The first response did not pause.');
        releaseFirst();
        await view.getByText('Stream <em>partial</em> complete.', { exact: true }).waitFor();
        await view.getByRole('button', { name: 'Send' }).waitFor();
        assert.equal(await composer.inputValue(), 'Later draft');
        assert.equal(await model.isEnabled(), true);

        await composer.fill('Line one');
        await composer.press('Shift+Enter');
        await composer.pressSequentially('Line two');
        assert.equal(await composer.inputValue(), 'Line one\nLine two');
        assert.equal(agent.requests.length, 1);
        await composer.press('Enter');
        await view.getByText('Multiline accepted.').waitFor();
        await view.getByRole('button', { name: 'Send' }).waitFor();
        const multilineRequest = agent.requests.at(1);
        assert.ok(multilineRequest);
        assert.match(latestUser(multilineRequest), /Line one\\nLine two/);
        assert.equal(await composer.inputValue(), '');
        await composer.fill('  \n  ');
        await composer.press('Enter');
        assert.equal(await view.getByRole('button', { name: 'Stop' }).count(), 0);
        assert.equal(agent.requests.length, 2);

        await composer.fill('Recover failed send');
        await view.getByRole('button', { name: 'Send' }).click();
        await view.locator('.agent-error').waitFor();
        await agent.page.waitForFunction(
          () =>
            document.querySelector<HTMLTextAreaElement>(
              '.agent-view textarea[aria-label="Message"]',
            )?.value === 'Recover failed send',
        );
        assert.equal(await composer.inputValue(), 'Recover failed send');
        assert.equal(agent.requests.length, 3);

        await composer.fill('Keep replacement after error');
        await view.getByRole('button', { name: 'Send' }).click();
        await view.getByRole('button', { name: 'Stop' }).waitFor();
        await view.locator('.agent-error').waitFor({ state: 'detached' });
        await composer.fill('Newer draft');
        assert.ok(releaseDelayedError, 'The delayed error response did not pause.');
        releaseDelayedError();
        await view.locator('.agent-error').waitFor();
        await view.getByRole('button', { name: 'Send' }).waitFor();
        assert.equal(await composer.inputValue(), 'Newer draft');
        assert.equal(agent.requests.length, 4);

        await composer.fill('Stop this reply');
        await view.getByRole('button', { name: 'Send' }).click();
        await view.getByText('Stopped partial').waitFor();
        await view.getByRole('button', { name: 'Stop' }).click();
        await view.getByRole('button', { name: 'Send' }).waitFor();
        await waitFor(() => stopClosed, 'stopped model stream to close');
        await waitFor(
          () =>
            agent
              .savedData()
              .chats?.some(
                (chat) => chat.interrupted && JSON.stringify(chat).includes('Stopped partial'),
              ) === true,
          'stopped partial response to persist',
        );
        const stoppedChatId = agent.savedData().activeChatId;
        assert.ok(stoppedChatId);
        await closeSidebar(agent.page);
        await agent.openSidebar();
        await view.getByText('Stopped partial').waitFor();
        await view.getByText('Interrupted').waitFor();
        assert.equal(await view.getByRole('button', { name: 'New chat' }).count(), 1);
        assert.equal(await view.getByRole('button', { name: 'Send' }).count(), 1);
        await view.getByRole('button', { name: 'Saved chats', exact: true }).click();
        await view.locator('button[data-chat-id="newer"]').click();
        await view.getByText('Rendered <b>as text</b>', { exact: true }).waitFor();
        const stoppedChatButton = view.locator(`button[data-chat-id="${stoppedChatId}"]`);
        if (!(await stoppedChatButton.isVisible()))
          await view.getByRole('button', { name: 'Saved chats', exact: true }).click();
        await stoppedChatButton.click();
        await view.getByText('Stopped partial').waitFor();
        await assertResponsiveTheme(agent.page, view);
        await agent.page.reload();
        await agent.openSidebar();
        await view.getByText('Stopped partial').waitFor();
        await view.getByText('Interrupted').waitFor();
        assert.equal(await model.inputValue(), 'custom-fixture::fixture-alternate');
        assert.equal(await thinking.inputValue(), 'high');

        await agent.newChat();
        await composer.fill('Switch this run');
        await view.getByRole('button', { name: 'Send' }).click();
        await view.getByText('Switch partial').waitFor();
        await view.getByRole('button', { name: 'Saved chats' }).click();
        await view.locator('button[data-chat-id="newer"]').click();
        await view.getByText('Rendered <b>as text</b>', { exact: true }).waitFor();
        await waitFor(() => switchClosed, 'switched model stream to close');
        assert.equal(await view.getByText('Switch partial').count(), 0);
        assert.equal(await view.getByText('Switch partial late completion').count(), 0);
        await waitFor(
          () => agent.savedData().activeChatId === 'newer',
          'saved chat selection to persist',
        );
        assert.equal(await view.getByRole('button', { name: 'Send' }).count(), 1);

        await agent.newChat();
        await composer.fill('New chat cancels run');
        await view.getByRole('button', { name: 'Send' }).click();
        await view.getByText('New chat partial').waitFor();
        await agent.newChat();
        await waitFor(() => newChatClosed, 'new-chat model stream to close');
        assert.equal(await view.getByText('New chat partial').count(), 0);
        assert.equal(await view.getByText('New chat partial late completion').count(), 0);
        assert.equal(await view.getByRole('button', { name: 'Send' }).count(), 1);
        assert.equal(await view.getByRole('button', { name: 'Stop' }).count(), 0);
        assert.equal(agent.requests.length, 7);
      },
      {
        data: seeded,
        modelHandler: async (request, stream) => {
          const turn = latestUser(request);
          if (turn.includes('Please summarize')) {
            stream.chunk({ role: 'assistant', content: 'Stream <em>partial</em>' });
            await firstHeld;
            stream.chunk({ content: ' complete.' });
            stream.finish();
            return;
          }
          if (turn.includes('Line one')) {
            reply(stream, 'Multiline accepted.');
            return;
          }
          if (turn.includes('Recover failed send')) {
            stream.response.destroy();
            return;
          }
          if (turn.includes('Keep replacement after error')) {
            await delayedErrorHeld;
            stream.response.destroy();
            return;
          }
          if (turn.includes('Stop this reply')) {
            stream.chunk({ role: 'assistant', content: 'Stopped partial' });
            await new Promise<void>((resolve) => stream.response.once('close', resolve));
            stream.chunk({ content: ' late completion' });
            stream.finish();
            stopClosed = true;
            return;
          }
          if (turn.includes('Switch this run')) {
            stream.chunk({ role: 'assistant', content: 'Switch partial' });
            await new Promise<void>((resolve) => stream.response.once('close', resolve));
            stream.chunk({ content: ' late completion' });
            stream.finish();
            switchClosed = true;
            return;
          }
          assert.match(turn, /New chat cancels run/);
          stream.chunk({ role: 'assistant', content: 'New chat partial' });
          await new Promise<void>((resolve) => stream.response.once('close', resolve));
          stream.chunk({ content: ' late completion' });
          stream.finish();
          newChatClosed = true;
        },
      },
    );
  } finally {
    releaseFirst?.();
    releaseDelayedError?.();
  }

  await withAgent(
    'react-sidebar-no-model',
    async (agent) => {
      await agent.openSidebar();
      const composer = agent.view().getByRole('textbox', { name: 'Message' });
      await composer.fill('Keep this after the error');
      await agent.view().getByRole('button', { name: 'Send' }).click();
      await agent
        .view()
        .locator('.agent-error')
        .getByText('Choose a model in the sidebar or configure one in settings.')
        .waitFor();
      assert.equal(await composer.inputValue(), 'Keep this after the error');
      assert.equal(agent.requests.length, 0);
    },
    { data: { model: '' } },
  );
});
