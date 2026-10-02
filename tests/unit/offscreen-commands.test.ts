/**
 * Contrato usado (SPEC-0012, revisão MINOR-2): entrypoints/offscreen/commands
 *   isCommand(message): valida `start` (urls e initUrl http(s), fmp4 booleano), `cancel` e `revoke`
 *     (blobUrl texto); qualquer outra forma é recusada;
 *   createCommandHandler({ run(start, signal), revoke(url) }) -> (command) => void: `start` com jobId já em
 *     execução é ignorado (não sobrescreve o controlador); `cancel` aborta o sinal do job.
 */
import { describe, expect, it, vi } from 'vitest';
import { createCommandHandler, isCommand } from '../../entrypoints/offscreen/commands';

const start = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  target: 'offscreen',
  type: 'start',
  jobId: 'j1',
  urls: ['https://cdn.example.test/a.ts'],
  fmp4: false,
  ...over,
});

describe('isCommand', () => {
  it('SPEC-0012:UT-02 aceita start/cancel/revoke bem formados', () => {
    expect(isCommand(start())).toBe(true);
    expect(isCommand(start({ initUrl: 'https://cdn.example.test/i.mp4', fmp4: true }))).toBe(true);
    expect(isCommand({ target: 'offscreen', type: 'cancel', jobId: 'j1' })).toBe(true);
    expect(isCommand({ target: 'offscreen', type: 'revoke', jobId: 'j1', blobUrl: 'blob:x' })).toBe(
      true,
    );
  });

  it('SPEC-0012:UT-02 recusa start com url que não é http(s) ou não é texto', () => {
    expect(isCommand(start({ urls: ['file:///etc/passwd'] }))).toBe(false);
    expect(isCommand(start({ urls: ['javascript:alert(1)'] }))).toBe(false);
    expect(isCommand(start({ urls: [42] }))).toBe(false);
    expect(isCommand(start({ urls: 'https://cdn.example.test/a.ts' }))).toBe(false);
    expect(isCommand(start({ urls: [] }))).toBe(false);
    expect(isCommand(start({ initUrl: 'data:video/mp4;base64,AA==', fmp4: true }))).toBe(false);
    expect(isCommand(start({ initUrl: 7, fmp4: true }))).toBe(false);
    expect(isCommand(start({ fmp4: 'sim' }))).toBe(false);
  });

  it('SPEC-0012:UT-02 recusa revoke sem blobUrl texto e mensagens de outro alvo', () => {
    expect(isCommand({ target: 'offscreen', type: 'revoke', jobId: 'j1' })).toBe(false);
    expect(isCommand({ target: 'offscreen', type: 'revoke', jobId: 'j1', blobUrl: 3 })).toBe(false);
    expect(isCommand({ target: 'background', type: 'cancel', jobId: 'j1' })).toBe(false);
    expect(isCommand({ target: 'offscreen', type: 'cancel' })).toBe(false);
    expect(isCommand(null)).toBe(false);
  });
});

describe('createCommandHandler', () => {
  it('SPEC-0012:UT-02 start repetido com o mesmo jobId é ignorado e cancel ainda aborta o job original', () => {
    const signals: AbortSignal[] = [];
    const run = vi.fn((_start: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>(() => undefined);
    });
    const handle = createCommandHandler({ run, revoke: vi.fn() });
    const first = start() as never;

    handle(first);
    handle(first);
    expect(run).toHaveBeenCalledTimes(1);
    handle({ target: 'offscreen', type: 'cancel', jobId: 'j1' });

    expect(signals[0]?.aborted).toBe(true);
  });

  it('SPEC-0012:UT-02 depois que o job termina o mesmo jobId pode iniciar de novo; revoke repassa a blob URL', async () => {
    const revoke = vi.fn();
    const run = vi.fn(() => Promise.resolve());
    const handle = createCommandHandler({ run, revoke });

    handle(start() as never);
    await Promise.resolve();
    await Promise.resolve();
    handle(start() as never);
    handle({ target: 'offscreen', type: 'revoke', jobId: 'j1', blobUrl: 'blob:abc' });

    expect(run).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith('blob:abc');
  });
});
