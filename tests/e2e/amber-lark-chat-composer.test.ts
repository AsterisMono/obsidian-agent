import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { App } from 'obsidian';
import type { Locator, Page } from 'playwright-core';
import {
  reloadApp,
  withAgent,
  type ModelRequest,
  type ModelStream,
  type TestPaths,
} from './support.ts';

declare global {
  interface Window {
    app: App;
  }
}

const ALTERNATE_MODEL = 'custom-fixture::fixture-alternate';
const LONG_MODEL_ID = 'fixture-model-with-a-deliberately-long-identifier-for-truncation';
const LONG_MODEL = `custom-fixture::${LONG_MODEL_ID}`;
const MISSING_MODEL = 'custom-fixture::missing-model';
const LONG_NOTE = 'a-note-with-a-deliberately-long-name-that-must-not-widen-the-composer.md';
const MODEL_ERROR = 'Choose a model in the sidebar or configure one in settings.';
const SIDEBAR_WIDTHS = [420, 320, 260];
const MINIMUM_CONTROL_HEIGHT = 31.5;
const MINIMUM_MODEL_WIDTH = 80;
const MINIMUM_TARGET_SIZE = 24;

type Box = { x: number; y: number; width: number; height: number };
type Control = { name: string; box: Box };
type Layout = {
  view: Box;
  card: Box;
  conversation: Box;
  textarea: Box;
  attachment: Box | null;
  controls: Control[];
  actionName: string;
  modelValue: string;
  modelText: string;
  modelOptions: string[];
  cardScroll: number;
  cardClient: number;
  viewScroll: number;
  viewClient: number;
};
type Placement = {
  cardContainsMessage: boolean;
  cardContainsModel: boolean;
  cardContainsThinking: boolean;
  cardInsideConversationLog: boolean;
  messageInsideConversationLog: boolean;
  modelAboveConversation: boolean;
  thinkingAboveConversation: boolean;
  controlsBelowMessage: boolean;
  cardBelowConversation: boolean;
  modelValue: string;
  modelText: string;
  modelIsNativeSelect: boolean;
  thinkingIsNativeSelect: boolean;
};

function waitFor(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 10000;
  return new Promise<void>((resolve, reject) => {
    const poll = () => {
      if (check()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for ${description}.`));
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function latestUser(request: ModelRequest): string {
  const message = [...request.messages].reverse().find((item) => item.role === 'user');
  assert.ok(message, 'The model request has no user message.');
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
}

function reply(stream: ModelStream, content: string): void {
  stream.chunk({ role: 'assistant', content });
  stream.finish();
}

function assertContained(inner: Box, outer: Box, description: string): void {
  assert.ok(inner.x >= outer.x - 1, `${description} starts left of its container.`);
  assert.ok(inner.y >= outer.y - 1, `${description} starts above its container.`);
  assert.ok(
    inner.x + inner.width <= outer.x + outer.width + 1,
    `${description} exceeds its container width.`,
  );
  assert.ok(
    inner.y + inner.height <= outer.y + outer.height + 1,
    `${description} exceeds its container height.`,
  );
}

function assertSeparated(first: Control, second: Control, description: string): void {
  const overlapX =
    Math.min(first.box.x + first.box.width, second.box.x + second.box.width) -
    Math.max(first.box.x, second.box.x);
  const overlapY =
    Math.min(first.box.y + first.box.height, second.box.y + second.box.height) -
    Math.max(first.box.y, second.box.y);
  assert.ok(
    overlapX <= 1 || overlapY <= 1,
    `${first.name} overlaps ${second.name} ${description}.`,
  );
}

async function assertUniqueControls(view: Locator): Promise<void> {
  assert.equal(await view.locator('textarea[aria-label="Message"]').count(), 1, 'message fields');
  assert.equal(await view.locator('select[aria-label="Model"]').count(), 1, 'model selects');
  assert.equal(await view.locator('select[aria-label="Thinking"]').count(), 1, 'thinking selects');
  assert.equal(
    await view.getByRole('button', { name: 'Attach active note', exact: true }).count(),
    1,
    'attach buttons',
  );
  assert.equal(
    await view.getByRole('button', { name: 'Send', exact: true }).count(),
    1,
    'send buttons',
  );
  assert.equal(
    await view.getByRole('button', { name: 'New chat', exact: true }).count(),
    1,
    'new chat buttons',
  );
  assert.equal(await view.getByRole('combobox').count(), 2, 'comboboxes');
  assert.equal(await view.getByRole('textbox').count(), 1, 'textboxes');
}

async function placement(page: Page): Promise<Placement> {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    const required = (selector: string, root: ParentNode): HTMLElement => {
      const element = root.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`);
      return element;
    };
    const view = required('.agent-view', document);
    const card = required('.agent-composer-card', view);
    const conversation = required('.agent-conversation', view);
    const textarea = required('textarea[aria-label="Message"]', view);
    const model = required('select[aria-label="Model"]', view);
    const thinking = required('select[aria-label="Thinking"]', view);
    const log = view.querySelector('[role="log"]');
    const controls = Array.from(card.querySelectorAll('button, select'));
    return {
      cardContainsMessage: card.contains(textarea),
      cardContainsModel: card.contains(model),
      cardContainsThinking: card.contains(thinking),
      cardInsideConversationLog: log instanceof HTMLElement && log.contains(card),
      messageInsideConversationLog: log instanceof HTMLElement && log.contains(textarea),
      modelAboveConversation: box(model).bottom <= box(conversation).top + 1,
      thinkingAboveConversation: box(thinking).bottom <= box(conversation).top + 1,
      controlsBelowMessage: [model, thinking, ...controls].every(
        (element) => box(element).top >= box(textarea).bottom - 1,
      ),
      cardBelowConversation: box(card).top >= box(conversation).bottom - 1,
      modelValue: model instanceof HTMLSelectElement ? model.value : 'not-a-select',
      modelText:
        model instanceof HTMLSelectElement
          ? (model.selectedOptions.item(0)?.textContent ?? '').trim()
          : '',
      modelIsNativeSelect: model instanceof HTMLSelectElement,
      thinkingIsNativeSelect: thinking instanceof HTMLSelectElement,
    };
  });
}

async function layoutAt(page: Page, width: number): Promise<Layout> {
  return page.evaluate((splitWidth: number) => {
    const toBox = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const required = (selector: string, root: ParentNode): HTMLElement => {
      const element = root.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`);
      return element;
    };
    const view = required('.agent-view', document);
    const card = required('.agent-composer-card', view);
    const conversation = required('.agent-conversation', view);
    const textarea = required('textarea[aria-label="Message"]', card);
    const model = required('select[aria-label="Model"]', card);
    const thinking = required('select[aria-label="Thinking"]', card);
    const attach = required('[aria-label="Attach active note"]', card);
    const action = Array.from(card.querySelectorAll('button')).find((button) => {
      const label = button.getAttribute('aria-label') ?? '';
      const text = button.textContent.trim();
      return label === 'Send' || label === 'Stop' || text === 'Send' || text === 'Stop';
    });
    if (!(action instanceof HTMLElement)) throw new Error('The composer action button is absent.');
    if (!(model instanceof HTMLSelectElement))
      throw new Error('The Model control is not a select.');
    if (!(thinking instanceof HTMLSelectElement))
      throw new Error('The Thinking control is not a select.');
    const attachment = card.querySelector('.agent-attachment');
    const split = view.closest('.workspace-split.mod-right-split');
    if (split instanceof HTMLElement) {
      const value = `${String(splitWidth)}px`;
      split.style.width = value;
      split.style.minWidth = value;
      split.style.maxWidth = value;
      split.style.flexBasis = value;
    }
    const actionName = action.textContent.trim() || 'Send or Stop';
    const modelOptions = Array.from(model.querySelectorAll('option')).map((option) =>
      option.textContent.trim(),
    );
    return new Promise<Layout>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve({
            view: toBox(view),
            card: toBox(card),
            conversation: toBox(conversation),
            textarea: toBox(textarea),
            attachment: attachment instanceof HTMLElement ? toBox(attachment) : null,
            controls: [
              { name: 'Model', box: toBox(model) },
              { name: 'Thinking', box: toBox(thinking) },
              { name: 'Attach active note', box: toBox(attach) },
              { name: actionName, box: toBox(action) },
            ],
            actionName,
            modelValue: model.value,
            modelText: (model.selectedOptions.item(0)?.textContent ?? '').trim(),
            modelOptions,
            cardScroll: card.scrollWidth,
            cardClient: card.clientWidth,
            viewScroll: view.scrollWidth,
            viewClient: view.clientWidth,
          });
        });
      });
    });
  }, width);
}

function assertComposerLayout(layout: Layout, width: number): void {
  const suffix = `at ${String(width)} px`;
  assert.ok(
    layout.view.width <= width + 1,
    `The sidebar did not narrow to ${String(width)} px: ${String(layout.view.width)}.`,
  );
  assert.ok(
    layout.cardScroll <= layout.cardClient + 1,
    `The composer card scrolls horizontally ${suffix}.`,
  );
  assert.ok(layout.viewScroll <= layout.viewClient + 1, `The view scrolls horizontally ${suffix}.`);
  assertContained(layout.card, layout.view, `The composer card ${suffix}`);
  assertContained(layout.textarea, layout.card, `The message field ${suffix}`);
  assert.ok(
    layout.card.y >= layout.conversation.y + layout.conversation.height - 1,
    `The composer card covers the conversation ${suffix}.`,
  );
  for (const control of layout.controls) {
    assertContained(control.box, layout.card, `${control.name} ${suffix}`);
    assertContained(control.box, layout.view, `${control.name} ${suffix}`);
    assert.ok(
      control.box.height >= MINIMUM_CONTROL_HEIGHT,
      `${control.name} is shorter than 32 px ${suffix}.`,
    );
    assert.ok(
      control.box.width >= MINIMUM_TARGET_SIZE && control.box.height >= MINIMUM_TARGET_SIZE,
      `${control.name} is smaller than a 24 px target ${suffix}.`,
    );
  }
  const model = layout.controls.find((control) => control.name === 'Model');
  assert.ok(model, 'The composer has no Model control.');
  assert.ok(
    model.box.width >= MINIMUM_MODEL_WIDTH,
    `The Model control shrank below ${String(MINIMUM_MODEL_WIDTH)} px ${suffix}.`,
  );
  for (const [index, first] of layout.controls.entries()) {
    for (const second of layout.controls.slice(index + 1)) assertSeparated(first, second, suffix);
  }
  if (layout.attachment) {
    const attachment: Control = { name: 'The attachment', box: layout.attachment };
    assertContained(layout.attachment, layout.card, `The attachment ${suffix}`);
    assert.ok(
      layout.attachment.y + layout.attachment.height <= layout.textarea.y + 1,
      `The attachment is not above the message field ${suffix}.`,
    );
    for (const control of layout.controls) assertSeparated(attachment, control, suffix);
  }
}

async function activeControlName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return '';
    return element.getAttribute('aria-label') ?? element.textContent.trim();
  });
}

async function activeFocusIndicator(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return 0;
    const style = getComputedStyle(element);
    const outline = Number.parseFloat(style.outlineWidth);
    const shadow = style.boxShadow === 'none' ? 0 : 1;
    return Math.max(Number.isFinite(outline) ? outline : 0, shadow);
  });
}

async function scrollConversation(page: Page, position: 'top' | 'bottom'): Promise<Box> {
  return page.evaluate((target: string) => {
    const conversation = document.querySelector('.agent-conversation');
    const card = document.querySelector('.agent-composer-card');
    if (!(conversation instanceof HTMLElement)) throw new Error('The conversation is absent.');
    if (!(card instanceof HTMLElement)) throw new Error('The composer card is absent.');
    conversation.scrollTop = target === 'top' ? 0 : conversation.scrollHeight;
    const rect = card.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, position);
}

async function closeSidebar(page: Page): Promise<void> {
  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeavesOfType('agent-chat').at(0);
    if (leaf === undefined) throw new Error('Agent sidebar leaf is absent.');
    leaf.detach();
  });
  await page.locator('.agent-view').waitFor({ state: 'detached' });
}

function configureFixture(paths: TestPaths): void {
  const file = path.join(paths.pluginDir, 'data.json');
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isRecord(parsed)) throw new Error('The plugin data file is not an object.');
  const endpoints = parsed.customEndpoints;
  if (!Array.isArray(endpoints)) throw new Error('The plugin data file has no custom endpoints.');
  const endpoint: unknown = endpoints[0];
  if (!isRecord(endpoint)) throw new Error('The fixture endpoint is missing.');
  const models = endpoint.models;
  if (!Array.isArray(models)) throw new Error('The fixture endpoint has no models.');
  models.push(LONG_MODEL_ID);
  fs.writeFileSync(file, JSON.stringify(parsed));
  fs.writeFileSync(path.join(paths.vault, LONG_NOTE), '# Long note\n\nLong note content.\n');
}

await test('Chat composer keeps model and thinking selection beside the message field', async () => {
  let releaseHeld: (() => void) | undefined;
  let stopClosed = false;
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });

  await withAgent(
    'composer-selection',
    async (agent) => {
      const { page } = agent;
      const view = agent.view();
      await agent.openSidebar();
      const composer = view.getByRole('textbox', { name: 'Message' });
      const model = view.getByRole('combobox', { name: 'Model' });
      const thinking = view.getByRole('combobox', { name: 'Thinking' });
      const send = view.getByRole('button', { name: 'Send', exact: true });
      const attach = view.getByRole('button', { name: 'Attach active note', exact: true });

      await assertUniqueControls(view);
      const initial = await placement(page);
      assert.ok(initial.cardContainsMessage, 'The Message field is not inside the composer card.');
      assert.ok(initial.cardContainsModel, 'The Model select is not inside the composer card.');
      assert.ok(
        initial.cardContainsThinking,
        'The Thinking select is not inside the composer card.',
      );
      assert.ok(
        initial.modelIsNativeSelect && initial.thinkingIsNativeSelect,
        'The composer selectors are not native selects.',
      );
      assert.ok(
        !initial.messageInsideConversationLog && !initial.cardInsideConversationLog,
        'The composer is rendered inside the conversation log.',
      );
      assert.ok(
        !initial.modelAboveConversation && !initial.thinkingAboveConversation,
        'A selector strip remains above the conversation.',
      );
      assert.ok(
        initial.controlsBelowMessage,
        'The composer controls are not below the message field.',
      );
      assert.ok(initial.cardBelowConversation, 'The composer card is above the conversation.');
      assert.equal(initial.modelValue, '');
      assert.equal(initial.modelText, 'Choose a model');
      assert.equal(await thinking.inputValue(), 'medium');
      assert.equal(agent.savedData().model, MISSING_MODEL);

      await composer.fill('Recover from an unavailable model');
      await send.click();
      await view.locator('.agent-error').getByText(MODEL_ERROR).waitFor();
      assert.equal(await composer.inputValue(), 'Recover from an unavailable model');
      assert.equal(agent.requests.length, 0);
      assert.equal((await placement(page)).modelText, 'Choose a model');

      await model.selectOption(ALTERNATE_MODEL);
      await waitFor(
        () => agent.savedData().model === ALTERNATE_MODEL,
        'the recovered model selection to persist',
      );
      assert.equal(await composer.inputValue(), 'Recover from an unavailable model');
      assert.equal(agent.requests.length, 0);
      await composer.press('Enter');
      await view.getByText('Recovered reply.').waitFor();
      await send.waitFor();
      assert.equal(agent.requests[0]?.model, 'fixture-alternate');
      assert.equal(await composer.inputValue(), '');
      assert.equal(await model.isEnabled(), true);
      assert.equal(await thinking.isEnabled(), true);
      const configured = await placement(page);
      assert.equal(configured.modelValue, ALTERNATE_MODEL);
      assert.match(configured.modelText, /fixture-alternate/);

      await composer.fill('Draft that survives keyboard navigation');
      const requests = agent.requests.length;
      await composer.focus();
      await page.keyboard.press('Tab');
      assert.equal(await activeControlName(page), 'Model');
      assert.ok((await activeFocusIndicator(page)) > 0, 'The Model control shows no focus.');
      await page.keyboard.press('Tab');
      assert.equal(await activeControlName(page), 'Thinking');
      assert.ok((await activeFocusIndicator(page)) > 0, 'The Thinking control shows no focus.');
      await page.keyboard.press('ArrowUp');
      await waitFor(
        () => agent.savedData().thinking === 'low',
        'keyboard thinking selection to persist',
      );
      assert.equal(await thinking.inputValue(), 'low');
      assert.equal(await composer.inputValue(), 'Draft that survives keyboard navigation');
      await thinking.focus();
      await page.keyboard.press('Tab');
      assert.equal(await activeControlName(page), 'Attach active note');
      assert.ok((await activeFocusIndicator(page)) > 0, 'The Attach control shows no focus.');
      await page.keyboard.press('Tab');
      assert.equal(await activeControlName(page), 'Send');
      assert.ok((await activeFocusIndicator(page)) > 0, 'The Send control shows no focus.');
      assert.equal(await composer.inputValue(), 'Draft that survives keyboard navigation');
      assert.equal(agent.requests.length, requests);

      const composed = await page.evaluate(() => {
        const field = document.querySelector('.agent-view textarea[aria-label="Message"]');
        if (!(field instanceof HTMLTextAreaElement))
          throw new Error('The message field is absent.');
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
          isComposing: true,
        });
        field.dispatchEvent(event);
        return event.isComposing;
      });
      assert.equal(composed, true, 'The synthetic composition event did not report isComposing.');
      assert.equal(await composer.inputValue(), 'Draft that survives keyboard navigation');
      assert.equal(agent.requests.length, requests);

      await composer.fill('   ');
      assert.equal(await send.isDisabled(), true);
      await composer.press('Enter');
      assert.equal(agent.requests.length, requests);
      assert.equal(await view.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
      await composer.fill('');
      assert.equal(await send.isDisabled(), true);

      await composer.fill('Draft survives every selection change');
      await model.selectOption(LONG_MODEL);
      await thinking.selectOption('high');
      assert.equal(await composer.inputValue(), 'Draft survives every selection change');
      await waitFor(
        () => agent.savedData().model === LONG_MODEL && agent.savedData().thinking === 'high',
        'the composer selections to persist',
      );

      await closeSidebar(page);
      await agent.openSidebar();
      await assertUniqueControls(view);
      assert.equal(await model.inputValue(), LONG_MODEL);
      assert.equal(await thinking.inputValue(), 'high');
      await reloadApp(page);
      await agent.openSidebar();
      await assertUniqueControls(view);
      assert.equal(await model.inputValue(), LONG_MODEL);
      assert.equal(await thinking.inputValue(), 'high');
      const reloaded = await placement(page);
      assert.ok(
        reloaded.cardContainsModel && reloaded.controlsBelowMessage,
        'The reloaded composer lost its placement.',
      );
      assert.match(reloaded.modelText, /fixture-model-with-a-deliberately-long-identifier/);

      await page.locator(`.nav-file-title[data-path="${LONG_NOTE}"]`).first().click();
      await attach.click();
      await view.locator('.agent-attachment').waitFor();
      assert.equal(await view.locator('.agent-attachment').count(), 1);
      assert.equal(
        ((await view.locator('.agent-attachment').textContent()) ?? '').trim(),
        LONG_NOTE,
      );
      const attached = await placement(page);
      assert.ok(
        attached.cardContainsMessage && attached.controlsBelowMessage,
        'Attaching a note moved the composer controls.',
      );

      const beforeLongModel = agent.requests.length;
      await composer.fill('Run with the long model name');
      await send.click();
      await view.getByText('Long model reply.').waitFor();
      await send.waitFor();
      assert.equal(agent.requests.length, beforeLongModel + 1);
      assert.equal(agent.requests[beforeLongModel]?.model, LONG_MODEL_ID);
      assert.match(
        latestUser(agent.requests[beforeLongModel] ?? { model: '', stream: false, messages: [] }),
        /Long note content/,
      );
      assert.equal(await view.locator('.agent-attachment').count(), 0);

      await agent.newChat();
      assert.equal(await model.inputValue(), LONG_MODEL);
      assert.equal(await thinking.inputValue(), 'high');
      const beforeHeld = agent.requests.length;
      await composer.fill('Hold this reply');
      await send.click();
      await waitFor(
        () => agent.requests.length === beforeHeld + 1,
        'the held request to reach the fixture',
      );
      assert.equal(await composer.inputValue(), '');
      assert.equal(await model.isDisabled(), true);
      assert.equal(await thinking.isDisabled(), true);
      assert.equal(await send.count(), 0);
      assert.equal(await view.getByRole('button', { name: 'Stop', exact: true }).count(), 1);
      await view.getByText('Held partial').waitFor();
      await composer.fill('Draft typed during the run');
      assert.equal(await composer.inputValue(), 'Draft typed during the run');
      assert.ok(releaseHeld, 'The held response did not pause.');
      releaseHeld();
      await view.getByText('Held partial and then done.').waitFor();
      await send.waitFor();
      assert.equal(await composer.inputValue(), 'Draft typed during the run');
      assert.equal(await model.isEnabled(), true);
      assert.equal(await thinking.isEnabled(), true);

      const beforeStop = agent.requests.length;
      await composer.fill('Stop this reply');
      await send.click();
      await view.getByText('Stopped partial').waitFor();
      await view.getByRole('button', { name: 'Stop', exact: true }).click();
      await send.waitFor();
      await composer.fill('Kept after stop');
      await waitFor(() => stopClosed, 'the stopped model stream to close');
      assert.equal(await composer.inputValue(), 'Kept after stop');
      assert.equal(await model.isEnabled(), true);
      assert.equal(await thinking.isEnabled(), true);
      assert.equal(agent.requests.length, beforeStop + 1);
      await view.getByText('Stopped partial').waitFor();
      await view.getByText('Interrupted').waitFor();

      await page.locator(`.nav-file-title[data-path="${LONG_NOTE}"]`).first().click();
      await attach.click();
      await view.locator('.agent-attachment').waitFor();
      assert.equal(await view.locator('.agent-attachment').count(), 1);
      await composer.fill('Line one\nLine two\nLine three');
      assert.equal(await model.inputValue(), LONG_MODEL);
      for (const width of SIDEBAR_WIDTHS) {
        const layout = await layoutAt(page, width);
        assertComposerLayout(layout, width);
        assert.equal(layout.modelValue, LONG_MODEL);
        assert.match(layout.modelText, /fixture-model-with-a-deliberately-long-identifier/);
        const option = layout.modelOptions.find((text) =>
          text.includes('fixture-model-with-a-deliberately-long-identifier'),
        );
        assert.ok(option, `The native picker lost the long model name at ${String(width)} px.`);
        assert.match(option, /custom-fixture/);
      }

      const narrow = await layoutAt(page, 260);
      const scrolledTop = await scrollConversation(page, 'top');
      const scrolledBottom = await scrollConversation(page, 'bottom');
      assert.ok(Math.abs(scrolledTop.y - narrow.card.y) <= 1, 'Scrolling moved the composer card.');
      assert.ok(
        Math.abs(scrolledBottom.y - narrow.card.y) <= 1,
        'Scrolling moved the composer card.',
      );
      await view.getByRole('button', { name: 'Saved chats', exact: true }).click();
      await view.locator('.agent-saved').waitFor();
      const panelOpen = await layoutAt(page, 260);
      assertComposerLayout(panelOpen, 260);
      await view.getByRole('button', { name: 'Saved chats', exact: true }).click();
      await view.locator('.agent-saved').waitFor({ state: 'detached' });

      await reloadApp(page);
      await agent.openSidebar();
      await assertUniqueControls(view);
      assert.equal(await model.inputValue(), LONG_MODEL);
      assert.equal(await thinking.inputValue(), 'high');
      const beforeSingle = agent.requests.length;
      await composer.fill('One click, one request');
      await send.click();
      await view.getByText('Single request reply.').waitFor();
      await send.waitFor();
      assert.equal(agent.requests.length, beforeSingle + 1);
      assert.equal(await composer.inputValue(), '');
    },
    {
      data: { model: MISSING_MODEL, thinking: 'medium' },
      prepareVault: configureFixture,
      modelHandler: async (request, stream) => {
        const turn = latestUser(request);
        if (turn.includes('Hold this reply')) {
          stream.chunk({ role: 'assistant', content: 'Held partial' });
          await held;
          stream.chunk({ content: ' and then done.' });
          stream.finish();
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
        if (turn.includes('Recover from an unavailable model')) {
          reply(stream, 'Recovered reply.');
          return;
        }
        if (turn.includes('Run with the long model name')) {
          reply(stream, 'Long model reply.');
          return;
        }
        if (turn.includes('One click, one request')) {
          reply(stream, 'Single request reply.');
          return;
        }
        reply(stream, 'Fixture reply.');
      },
    },
  );

  await withAgent(
    'composer-no-model',
    async (agent) => {
      const view = agent.view();
      await agent.openSidebar();
      const composer = view.getByRole('textbox', { name: 'Message' });
      const send = view.getByRole('button', { name: 'Send', exact: true });
      const initial = await placement(agent.page);
      assert.equal(initial.modelValue, '');
      assert.equal(initial.modelText, 'Choose a model');
      assert.ok(initial.cardContainsModel, 'The Model select is not inside the composer card.');
      await composer.fill('Keep this draft after the model error');
      await send.click();
      await view.locator('.agent-error').getByText(MODEL_ERROR).waitFor();
      assert.equal(await composer.inputValue(), 'Keep this draft after the model error');
      assert.equal(agent.requests.length, 0);
      await view.getByRole('combobox', { name: 'Model' }).selectOption(ALTERNATE_MODEL);
      await composer.press('Enter');
      await view.getByText('Fixture reply.').waitFor();
      await send.waitFor();
      assert.equal(agent.requests.length, 1);
      assert.equal(agent.requests[0]?.model, 'fixture-alternate');
      assert.equal(await composer.inputValue(), '');
    },
    {
      data: { model: '' },
      modelHandler: (_request, stream) => {
        reply(stream, 'Fixture reply.');
      },
    },
  );
});
