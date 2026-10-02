import { candidatesOfSnapshot } from './extract';
import type { FrameSnapshot, VideoCandidate } from './contracts';

/** Origem 'esquema://host[:porta]' (porta padrão omitida) de uma URL http(s); undefined nos demais casos. */
function httpOrigin(url: string, base?: string): string | undefined {
  try {
    const parsed = new URL(url, base);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Origens 'https://host[:porta]' dos `<iframe src>` http(s) diferentes de `pageOrigin`
 * (`pageOrigin` = origem do frame que contém os iframes; `src` relativo resolve contra ela).
 * Sem repetição e sem caminho/query; `about:blank`, `data:`, `javascript:` e vazios são ignorados.
 * ATENÇÃO: `collectVideos` (entrypoints/background) duplica esta lógica porque é serializada na página.
 */
export function findCrossOriginFrames(iframeSrcs: readonly string[], pageOrigin: string): string[] {
  const found = new Set<string>();
  for (const src of iframeSrcs) {
    if (src.trim() === '') {
      continue;
    }
    const origin = httpOrigin(src.trim(), `${pageOrigin}/`);
    if (origin !== undefined && origin !== pageOrigin) {
      found.add(origin);
    }
  }
  return [...found];
}

/**
 * Candidatos de todos os frames: `frameId`/`frameUrl` do frame de origem; a mesma `mediaUrl` em
 * vários frames vira um candidato só (vale o menor `frameId`); `id` = candidateId(tabId, mediaUrl).
 */
export function mergeFrameSnapshots(
  frames: readonly FrameSnapshot[],
  tabId: number,
): VideoCandidate[] {
  const found = new Map<string, VideoCandidate>();
  const ordered = [...frames].sort((a, b) => a.frameId - b.frameId);
  for (const { frameId, snapshot } of ordered) {
    for (const candidate of candidatesOfSnapshot(snapshot, tabId, frameId)) {
      const existing = found.get(candidate.mediaUrl);
      if (existing === undefined) {
        found.set(candidate.mediaUrl, candidate);
      } else if (candidate.protection === 'drm') {
        existing.protection = 'drm';
      }
    }
  }
  return [...found.values()];
}

/**
 * `seen` - `pageOrigin` - `granted`, só origens http(s), ordenadas e sem repetição.
 */
export function computeBlockedOrigins(
  seen: readonly string[],
  pageOrigin: string,
  granted: ReadonlySet<string>,
): string[] {
  const blocked = new Set<string>();
  for (const origin of seen) {
    if (/^https?:\/\/[^\s/?#]+$/i.test(origin) && origin !== pageOrigin && !granted.has(origin)) {
      blocked.add(origin);
    }
  }
  return [...blocked].sort();
}

/** Origem http(s) de uma URL (para o frame principal); undefined quando não é http(s). */
export function originOf(url: string): string | undefined {
  return httpOrigin(url);
}
