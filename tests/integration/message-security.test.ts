/**
 * Contrato usado (SPEC-0005:IT-03): o background só age em mensagens válidas de
 * `sender.id === browser.runtime.id`; as demais recebem `{ ok: false, error: 'INVALID_MESSAGE' }`
 * sem chamar `scripting` nem `downloads`, e a rejeição é registrada no diagnóstico.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, startBackground, video } from './support/background';
import type { BackgroundHarness } from './support/background';

const INVALID = { ok: false, error: 'INVALID_MESSAGE' };
let bg: BackgroundHarness;

beforeEach(() => {
  bg = startBackground();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('background: validação de mensagens', () => {
  it('SPEC-0005:IT-03 mensagem válida de outra extensão responde INVALID_MESSAGE e não chama nenhuma porta', async () => {
    const tabId = await bg.newTab();

    expect(await bg.send({ type: 'detect', tabId }, 'outra-extensao')).toEqual(INVALID);
    expect(await bg.send({ type: 'download', candidateId: 'x' }, 'outra-extensao')).toEqual(
      INVALID,
    );

    expect(bg.executeScript).not.toHaveBeenCalled();
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0005:IT-03 candidato existente não pode ser baixado por outra extensão', async () => {
    const media = 'https://cdn.example.test/media/aula.mp4';
    const { candidates } = await bg.detect(page([video({ src: media, currentSrc: media })]));

    const response = await bg.send(
      { type: 'download', candidateId: candidates[0]?.id },
      'outra-extensao',
    );

    expect(response).toEqual(INVALID);
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0005:IT-03 payload fora do schema responde INVALID_MESSAGE e não chama nenhuma porta', async () => {
    for (const payload of [
      { type: 'download' },
      { type: 'detect', tabId: 'x' },
      { type: 'nope' },
      'texto',
      42,
    ]) {
      expect(await bg.send(payload), JSON.stringify(payload)).toEqual(INVALID);
    }

    expect(bg.executeScript).not.toHaveBeenCalled();
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0005:IT-03 a mensagem rejeitada é registrada no diagnóstico', async () => {
    await bg.send({ type: 'nope' }, 'outra-extensao');

    const response = (await bg.send({ type: 'diagnostics' })) as {
      ok: boolean;
      entries: unknown[];
    };

    expect(response.ok).toBe(true);
    expect(response.entries.length).toBeGreaterThan(0);
  });
});
