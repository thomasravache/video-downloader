/**
 * Contrato usado (SPEC-0013 §6) — `runOffscreenJob(request, deps)` (entrypoints/offscreen/run-job):
 *  com `ranges[i]` o fetch do segmento i é `GET url` com o cabeçalho `Range: bytes=<offset>-<offset+length-1>`
 *  e `credentials: 'include'`; `initRange` faz o mesmo para o `initUrl`; segmento sem faixa (undefined) ou
 *  playlist sem ranges NÃO leva `Range`. A resposta aceita é 206 com `Content-Range` igual ao pedido.
 */
import { describe, expect, it } from 'vitest';
import { runOffscreenJob } from '../../entrypoints/offscreen/run-job';
import type { OffscreenEvent, OffscreenStart } from '../../src/core/hls-download';

interface Seen {
  url: string;
  range: string | null;
  credentials: RequestCredentials | undefined;
}

/** `fetch` falso que responde 206 coerente com o pedido (ou 200 quando não há Range). */
function rangeFetch(seen: Seen[]): typeof fetch {
  return ((input: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    seen.push({ url: input, range, credentials: init?.credentials });
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
    if (!match) {
      return Promise.resolve(new Response(new Uint8Array(8), { status: 200 }));
    }
    const [from, to] = [Number(match[1]), Number(match[2])];
    return Promise.resolve(
      new Response(new Uint8Array(to - from + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${String(from)}-${String(to)}/${String(to + 1000)}` },
      }),
    );
  }) as unknown as typeof fetch;
}

async function run(
  request: Partial<OffscreenStart>,
): Promise<{ seen: Seen[]; events: OffscreenEvent[] }> {
  const seen: Seen[] = [];
  const events: OffscreenEvent[] = [];
  await runOffscreenJob(
    {
      target: 'offscreen',
      type: 'start',
      jobId: 'j1',
      urls: ['https://cdn.example.test/a.m4s'],
      fmp4: false,
      ...request,
    },
    {
      fetch: rangeFetch(seen),
      emit: (event) => events.push(event),
      signal: new AbortController().signal,
      sleep: () => Promise.resolve(),
    },
  );
  return { seen, events };
}

describe('cabeçalho Range do offscreen', () => {
  it('SPEC-0013:UT-08 {offset:1573, length:1060672} vira "bytes=1573-1062244", com credentials include', async () => {
    const { seen } = await run({ ranges: [{ offset: 1573, length: 1_060_672 }] });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.range).toBe('bytes=1573-1062244');
    expect(seen[0]?.credentials).toBe('include');
  });

  it('SPEC-0013:UT-08 initRange vai no Range do initUrl; segmento sem faixa (undefined) vai sem Range', async () => {
    const { seen } = await run({
      fmp4: true,
      initUrl: 'https://cdn.example.test/i.mp4',
      initRange: { offset: 0, length: 893 },
      urls: ['https://cdn.example.test/a.m4s', 'https://cdn.example.test/whole.m4s'],
      ranges: [{ offset: 893, length: 100 }, undefined],
    });

    const byUrl = Object.fromEntries(seen.map((s) => [s.url, s.range]));
    expect(byUrl['https://cdn.example.test/i.mp4']).toBe('bytes=0-892');
    expect(byUrl['https://cdn.example.test/a.m4s']).toBe('bytes=893-992');
    expect(byUrl['https://cdn.example.test/whole.m4s']).toBeNull();
  });

  it('SPEC-0013:UT-08 (guarda) start sem ranges: nenhuma requisição leva Range', async () => {
    const { seen } = await run({
      urls: ['https://cdn.example.test/a.m4s', 'https://cdn.example.test/b.m4s'],
    });

    expect(seen).toHaveLength(2);
    expect(seen.every((s) => s.range === null)).toBe(true);
  });
});
