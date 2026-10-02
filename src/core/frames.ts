import type { FrameSnapshot, VideoCandidate } from './contracts';

/**
 * Origens 'https://host[:porta]' dos `<iframe src>` http(s) diferentes de `pageOrigin`
 * (`pageOrigin` = origem do frame que contém os iframes; `src` relativo resolve contra ela).
 * Sem repetição e sem caminho/query; `about:blank`, `data:`, `javascript:` e vazios são ignorados.
 */
export function findCrossOriginFrames(
  _iframeSrcs: readonly string[],
  _pageOrigin: string,
): string[] {
  throw new Error('NotImplemented');
}

/**
 * Candidatos de todos os frames: `frameId`/`frameUrl` do frame de origem; a mesma `mediaUrl` em
 * vários frames vira um candidato só (vale o menor `frameId`); `id` = candidateId(tabId, mediaUrl).
 */
export function mergeFrameSnapshots(
  _frames: readonly FrameSnapshot[],
  _tabId: number,
): VideoCandidate[] {
  throw new Error('NotImplemented');
}

/**
 * `seen` - `pageOrigin` - `granted`, só origens http(s), ordenadas e sem repetição.
 */
export function computeBlockedOrigins(
  _seen: readonly string[],
  _pageOrigin: string,
  _granted: ReadonlySet<string>,
): string[] {
  throw new Error('NotImplemented');
}
