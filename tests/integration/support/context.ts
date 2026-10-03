/**
 * Ajudantes dos testes de integração da SPEC-0016 (contexto de requisição da página). Não é teste.
 *
 *  - `PLAYER`: a origem do frame que "tocava" o vídeo (iniciador das requisições observadas);
 *  - `guarded(routes)`: toda rota só responde com `Origin: PLAYER` + `Referer: PLAYER/` (senão 403);
 *  - `observeFrom`: observa a URL como resposta HLS da aba, com `initiator`, e devolve o candidato do `detect`;
 *  - `resolve`: a mensagem `resolveHls` como o popup a envia;
 *  - `seenOn` / `okWithoutContext`: o que o servidor viu por caminho.
 */
import { expect } from 'vitest';
import type { BackgroundHarness } from './background';
import { HLS_HEADERS, PAGE, detectCandidate } from './hls-job';
import { requireContext } from './playlist-server';
import type { Handler, PlaylistServer, RequestRecord } from './playlist-server';
import type { VideoCandidate } from '../../../src/core/contracts';

export const PLAYER = 'https://player.exemplo.test';
export const RESERVED_ID = 7_000_000;

export function guarded(routes: Record<string, Handler>, origin = PLAYER): Record<string, Handler> {
  return Object.fromEntries(
    Object.entries(routes).map(([path, handler]) => [path, requireContext(origin, handler)]),
  );
}

export async function observeFrom(
  bg: BackgroundHarness,
  url: string,
  initiator: string | null = PLAYER,
  tabId?: number,
): Promise<VideoCandidate> {
  const tab = tabId ?? (await bg.newTab(PAGE));
  await bg.network.respond({
    url,
    tabId: tab,
    headers: HLS_HEADERS,
    ...(initiator !== null && { initiator }),
  });
  return detectCandidate(bg, tab, url);
}

export type ResolveResult =
  | { ok: true; hls: { type: string; encrypted: boolean } }
  | { ok: false; error: string; status?: number };

export async function resolve(bg: BackgroundHarness, candidateId: string): Promise<ResolveResult> {
  return (await bg.send({ type: 'resolveHls', candidateId })) as ResolveResult;
}

/** Requisições do servidor para um caminho (sem query), em ordem. */
export function seenOn(server: PlaylistServer, path: string): RequestRecord[] {
  return server.log.filter((r) => new URL(r.url, 'http://x').pathname === path);
}

/** Toda requisição que o servidor aceitou (2xx) trouxe exatamente o contexto do player. */
export function expectAcceptedOnesCarriedContext(records: RequestRecord[], origin = PLAYER): void {
  for (const record of records.filter((r) => r.status === 200)) {
    expect(record.origin, record.url).toBe(origin);
    expect(record.referer, record.url).toBe(`${origin}/`);
  }
}
