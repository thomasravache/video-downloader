import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';

const PAGE = 'https://site.example.test/aula';
const MP4 = 'https://cdn.example.test/media/aula.mp4';
const MP4_HEADERS = { 'Content-Type': 'video/mp4', 'Content-Length': '5000000' };

let bg: BackgroundHarness;

beforeEach(() => {
  bg = startBackground();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const trigger = (event: unknown, ...args: unknown[]) =>
  (event as { trigger(...a: unknown[]): Promise<unknown> }).trigger(...args);

describe('indicador dinâmico da toolbar no background', () => {
  it('SPEC-0022:IT-01 ao receber resposta de rede com vídeo para a aba tabId, o background aciona o indicador da toolbar atualizando o badge para a quantidade de candidatos correspondente', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });

    const badgeText = await fakeBrowser.action.getBadgeText({ tabId });
    expect(badgeText).toBe('1');
  });

  it('SPEC-0022:IT-02 ao fechar aba ou navegar para nova página principal, o indicador da toolbar para a aba é resetado para o estado inativo', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });
    expect(await fakeBrowser.action.getBadgeText({ tabId })).toBe('1');

    await bg.network.navigate(tabId, 'https://site.example.test/outra');
    expect(await fakeBrowser.action.getBadgeText({ tabId })).toBe('');

    const tabId2 = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId: tabId2, headers: MP4_HEADERS });
    expect(await fakeBrowser.action.getBadgeText({ tabId: tabId2 })).toBe('1');

    await trigger(fakeBrowser.tabs.onRemoved, tabId2, { windowId: 0, isWindowClosing: false });
    expect(await fakeBrowser.action.getBadgeText({ tabId: tabId2 })).toBe('');
  });
});
