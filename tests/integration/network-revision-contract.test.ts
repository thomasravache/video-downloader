/**
 * Contrato usado (SPEC-0024:CT-01), seção 6:
 *   type NetworkRevisionRequest  = { type: 'network-revision'; tabId: number }      (tabId inteiro >= 0)
 *   type NetworkRevisionResponse = { ok: true; revision: number } | { ok: false; error: 'INVALID_MESSAGE' }
 *   - validação em src/core/messages.ts (validateMessage) e resposta do background real (runtime.onMessage);
 *   - aceita só da própria extensão, como as demais mensagens;
 *   - NetworkStore.revision(tabId): inteiro >= 0, 0 para aba sem histórico, incrementado a cada add efetivo e a
 *     cada clear da aba (monotônico).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoCandidate } from '../../src/core/contracts';
import { validateMessage } from '../../src/core/messages';
import { NetworkStore } from '../../src/core/network';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';

const PAGE = 'https://site.example.test/aula';
const MP4_HEADERS = { 'Content-Type': 'video/mp4', 'Content-Length': '5000000' };
const INVALID = { ok: false, error: 'INVALID_MESSAGE' };

let bg: BackgroundHarness;

beforeEach(() => {
  bg = startBackground();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sessionStore(): NetworkStore {
  return new NetworkStore({
    get: async (key) => (await fakeBrowser.storage.session.get(key))[key],
    set: (key, value) => fakeBrowser.storage.session.set({ [key]: value }),
    remove: (key) => fakeBrowser.storage.session.remove(key),
    keys: async () => Object.keys(await fakeBrowser.storage.session.get(null)),
  });
}

function candidate(tabId: number, mediaUrl: string): VideoCandidate {
  return {
    id: `id-${mediaUrl}`,
    providerId: 'network',
    tabId,
    pageUrl: '',
    mediaUrl,
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: '',
    kind: 'file',
    source: 'network',
  };
}

describe('contrato da mensagem network-revision', () => {
  it('SPEC-0024:CT-01 a validação aceita exatamente { type, tabId } e o background responde { ok: true, revision } inteiro >= 0', async () => {
    expect(
      validateMessage({ type: 'network-revision', tabId: 4 }, { id: bg.ownId }, bg.ownId),
    ).toEqual({
      ok: true,
      message: { type: 'network-revision', tabId: 4 },
    });
    const tabId = await bg.newTab(PAGE);

    const response = (await bg.send({ type: 'network-revision', tabId })) as Record<
      string,
      unknown
    >;

    expect(Object.keys(response).sort()).toEqual(['ok', 'revision']);
    expect(response['ok']).toBe(true);
    expect(Number.isInteger(response['revision'])).toBe(true);
    expect(response['revision'] as number).toBeGreaterThanOrEqual(0);
  });

  it('SPEC-0024:CT-01 a revisão devolvida pelo background cresce depois de uma captura de rede da aba', async () => {
    const tabId = await bg.newTab(PAGE);
    const before = (await bg.send({ type: 'network-revision', tabId })) as { revision: number };

    await bg.network.respond({
      url: 'https://cdn.example.test/v/aula.mp4',
      tabId,
      headers: MP4_HEADERS,
    });
    const after = (await bg.send({ type: 'network-revision', tabId })) as { revision: number };

    expect(after).toEqual({ ok: true, revision: expect.any(Number) as number });
    expect(after.revision).toBeGreaterThan(before.revision);
  });

  it('SPEC-0024:CT-01 (guarda: passa antes da mudança) tabId inválido ou outro remetente: o background responde exatamente { ok: false, error: INVALID_MESSAGE }', async () => {
    for (const message of [
      { type: 'network-revision' },
      { type: 'network-revision', tabId: -1 },
      { type: 'network-revision', tabId: 1.5 },
      { type: 'network-revision', tabId: '3' },
    ]) {
      expect(await bg.send(message), JSON.stringify(message)).toEqual(INVALID);
    }
    expect(await bg.send({ type: 'network-revision', tabId: 1 }, 'other-extension')).toEqual(
      INVALID,
    );
  });

  it('SPEC-0024:CT-01 NetworkStore.revision é 0 sem histórico e monotônica para add e clear', async () => {
    const store = sessionStore();
    const seen: number[] = [await store.revision(7)];

    await store.add(7, candidate(7, 'https://cdn.example.test/a.mp4'));
    seen.push(await store.revision(7));
    await store.add(7, candidate(7, 'https://cdn.example.test/b.mp4'));
    seen.push(await store.revision(7));
    await store.clear(7);
    seen.push(await store.revision(7));
    await store.add(7, candidate(7, 'https://cdn.example.test/c.mp4'));
    seen.push(await store.revision(7));

    expect(seen[0]).toBe(0);
    for (const value of seen) {
      expect(Number.isInteger(value) && value >= 0, String(value)).toBe(true);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], JSON.stringify(seen)).toBeGreaterThan(seen[i - 1] ?? Infinity);
    }
    expect(await store.revision(8)).toBe(0);
  });

  it('SPEC-0024:CT-01 aba fechada (tabs.onRemoved): vd:net:<id> e vd:netrev:<id> somem do storage.session e a revisão volta a 0', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({
      url: 'https://cdn.example.test/v/aula.mp4',
      tabId,
      headers: MP4_HEADERS,
    });
    const before = Object.keys(await fakeBrowser.storage.session.get(null));
    expect(before).toContain(`vd:net:${String(tabId)}`);
    expect(before).toContain(`vd:netrev:${String(tabId)}`);

    await (
      fakeBrowser.tabs.onRemoved as unknown as { trigger(...args: unknown[]): Promise<unknown> }
    ).trigger(tabId, { windowId: 0, isWindowClosing: false });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const after = Object.keys(await fakeBrowser.storage.session.get(null));
    expect(after).not.toContain(`vd:net:${String(tabId)}`);
    expect(after).not.toContain(`vd:netrev:${String(tabId)}`);
    expect(await sessionStore().revision(tabId)).toBe(0);
  });
});
