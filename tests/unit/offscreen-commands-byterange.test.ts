/**
 * Contrato usado (SPEC-0013 §6): `isCommand` do offscreen valida os campos opcionais do `start`:
 *   `ranges` (se presente: array com o MESMO tamanho de `urls`; cada item `undefined` ou {offset, length}
 *   inteiros seguros, offset >= 0, length >= 1) e `initRange` (só com `initUrl`; mesma forma de faixa).
 * Sem os campos novos o `start` da SPEC-0012@1 continua aceito (CT-01).
 */
import { describe, expect, it, vi } from 'vitest';
import { createCommandHandler, isCommand } from '../../entrypoints/offscreen/commands';
import { parseHlsPlaylist } from '../../src/core/hls';
import type { OffscreenStart } from '../../src/core/hls-download';

const URLS = ['https://cdn.example.test/a.m4s', 'https://cdn.example.test/a.m4s'];
const start = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  target: 'offscreen',
  type: 'start',
  jobId: 'j1',
  urls: URLS,
  fmp4: true,
  ...over,
});
const range = (offset: number, length: number) => ({ offset, length });

describe('isCommand: ranges e initRange', () => {
  it('SPEC-0013:UT-07 rejeita ranges de tamanho diferente de urls', () => {
    expect(isCommand(start({ ranges: [range(0, 10)] }))).toBe(false);
    expect(isCommand(start({ ranges: [range(0, 10), range(10, 10), range(20, 10)] }))).toBe(false);
    expect(isCommand(start({ ranges: [] }))).toBe(false);
    expect(isCommand(start({ ranges: 'bytes=0-9' }))).toBe(false);
  });

  it('SPEC-0013:UT-07 rejeita item de ranges não-objeto ou com faixa inválida', () => {
    const bad: unknown[] = [
      42,
      'x',
      [],
      { offset: -1, length: 10 },
      { offset: 0, length: 0 },
      { offset: 0, length: -5 },
      { offset: 1.5, length: 10 },
      { offset: 0, length: Number.NaN },
      { offset: Number.POSITIVE_INFINITY, length: 10 },
      { offset: '0', length: 10 },
      { offset: 0 },
      { length: 10 },
      { offset: Number.MAX_SAFE_INTEGER, length: 1 },
      { offset: 0, length: Number.MAX_SAFE_INTEGER + 2 },
    ];
    for (const item of bad) {
      expect(isCommand(start({ ranges: [range(0, 10), item] })), JSON.stringify(item)).toBe(false);
    }
  });

  it('SPEC-0013:UT-07 rejeita initRange sem initUrl e initRange inválido', () => {
    expect(isCommand(start({ initRange: range(0, 893) }))).toBe(false);
    expect(
      isCommand(start({ initUrl: 'https://cdn.example.test/a.m4s', initRange: range(-1, 5) })),
    ).toBe(false);
    expect(
      isCommand(start({ initUrl: 'https://cdn.example.test/a.m4s', initRange: range(0, 0) })),
    ).toBe(false);
    expect(isCommand(start({ initUrl: 'https://cdn.example.test/a.m4s', initRange: 'x' }))).toBe(
      false,
    );
  });

  it('SPEC-0013:UT-07 aceita campos coerentes (ranges alinhados, item undefined, initRange com initUrl)', () => {
    expect(isCommand(start({ ranges: [range(1573, 1_060_672), range(1_062_245, 987_654)] }))).toBe(
      true,
    );
    expect(isCommand(start({ ranges: [undefined, range(0, 10)] }))).toBe(true);
    expect(
      isCommand(
        start({
          initUrl: 'https://cdn.example.test/a.m4s',
          initRange: range(0, 893),
          ranges: [range(1573, 100), range(1673, 100)],
        }),
      ),
    ).toBe(true);
  });
});

describe('compatibilidade aditiva', () => {
  it('SPEC-0013:CT-01 start da SPEC-0012@1 (sem ranges/initRange) continua aceito e chega intacto ao executor', () => {
    const legacy = start({ initUrl: 'https://cdn.example.test/i.mp4' });
    const run = vi.fn(() => new Promise<void>(() => undefined));
    const handle = createCommandHandler({ run, revoke: vi.fn() });

    expect(isCommand(legacy)).toBe(true);
    handle(legacy as unknown as OffscreenStart);

    expect(run).toHaveBeenCalledTimes(1);
    const received = (run.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(received).toEqual(legacy);
    expect(received).not.toHaveProperty('ranges');
    expect(received).not.toHaveProperty('initRange');
  });

  it('SPEC-0013:CT-01 start com os campos novos é aceito e entregue com os campos preservados', () => {
    const extended = start({
      initUrl: 'https://cdn.example.test/a.m4s',
      initRange: range(0, 893),
      ranges: [range(1573, 100), range(1673, 100)],
    });
    const run = vi.fn(() => new Promise<void>(() => undefined));
    const handle = createCommandHandler({ run, revoke: vi.fn() });

    expect(isCommand(extended)).toBe(true);
    handle(extended as unknown as OffscreenStart);

    expect((run.mock.calls as unknown[][])[0]?.[0]).toEqual(extended);
  });

  it('SPEC-0013:CT-01 HlsInfo da SPEC-0011@1 não ganha campos de faixa (parseHlsPlaylist inalterado)', () => {
    const text =
      '#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\ns0.m4s\n#EXT-X-ENDLIST\n';

    const info = parseHlsPlaylist(text, 'https://cdn.example.test/m.m3u8');

    expect(info).toMatchObject({ type: 'media', live: false, encrypted: false });
    expect(Object.keys(info)).not.toContain('ranges');
    expect(Object.keys(info)).not.toContain('initRange');
  });
});
