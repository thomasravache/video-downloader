import type { VideoCandidate } from './contracts';

export interface CandidateStore {
  /** Substitui os candidatos da aba. */
  replaceTab(tabId: number, candidates: VideoCandidate[]): void;
  forTab(tabId: number): VideoCandidate[];
  find(candidateId: string): VideoCandidate | undefined;
  /** Substitui o candidato guardado (mesmo id), p.ex. com o `HlsInfo` resolvido. */
  update(candidate: VideoCandidate): void;
  /** Descarta o estado da aba (aba fechada). */
  removeTab(tabId: number): void;
}

/** Hash estável (cyrb53) de (tabId, mediaUrl), em hexadecimal. */
export function candidateId(tabId: number, mediaUrl: string): string {
  const text = `${String(tabId)}|${mediaUrl}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Agregador em memória, por aba; o estado some quando a aba fecha (ou o service worker dorme). */
export function createCandidateStore(): CandidateStore {
  const byTab = new Map<number, VideoCandidate[]>();
  const byId = new Map<string, VideoCandidate>();

  function removeTab(tabId: number): void {
    for (const candidate of byTab.get(tabId) ?? []) {
      byId.delete(candidate.id);
    }
    byTab.delete(tabId);
  }

  return {
    replaceTab(tabId, candidates) {
      removeTab(tabId);
      byTab.set(tabId, [...candidates]);
      for (const candidate of candidates) {
        byId.set(candidate.id, candidate);
      }
    },
    forTab: (tabId) => [...(byTab.get(tabId) ?? [])],
    find: (candidateId) => byId.get(candidateId),
    update(candidate) {
      if (!byId.has(candidate.id)) {
        return;
      }
      byId.set(candidate.id, candidate);
      const list = byTab.get(candidate.tabId);
      const at = list?.findIndex((c) => c.id === candidate.id) ?? -1;
      if (list && at >= 0) {
        list[at] = candidate;
      }
    },
    removeTab,
  };
}

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * Esconde candidatos `blob:` (`unsupported-stream` sem URL http(s)) quando a lista tem outra fonte baixável
 * ou HLS (SPEC-0013). Preserva a ordem e não muta a entrada.
 */
export function hideRedundantCandidates(candidates: VideoCandidate[]): VideoCandidate[] {
  const isNoise = (c: VideoCandidate): boolean =>
    c.support === 'unsupported-stream' && !isHttpUrl(c.mediaUrl);
  const hasSource = candidates.some(
    (c) => !isNoise(c) && (c.support === 'downloadable' || c.kind === 'hls'),
  );
  return hasSource ? candidates.filter((c) => !isNoise(c)) : [...candidates];
}

/** Cartão em destaque e as fontes redundantes recolhidas sob ele (SPEC-0015). */
export interface CandidateGroup {
  primary: VideoCandidate;
  related: VideoCandidate[];
}

/**
 * Agrupa por master HLS resolvida: variantes, faixas de áudio e arquivos de `hls.mediaResources` viram
 * `related` da primeira master que os reivindica; os demais candidatos são grupos de um elemento
 * (SPEC-0015 §6). Aplica antes `hideRedundantCandidates`, preserva a ordem e não muta a entrada.
 */
export function groupCandidates(candidates: VideoCandidate[]): CandidateGroup[] {
  const list = hideRedundantCandidates(candidates);
  const keys = list.map((c) => pathKey(c.mediaUrl));
  /** Posição do candidato -> posição da master que o reivindicou. */
  const claimedBy = new Map<number, number>();
  const primaries = new Set<number>();
  list.forEach((candidate, at) => {
    const hls = candidate.hls;
    if (candidate.kind !== 'hls' || hls?.type !== 'master' || claimedBy.has(at)) {
      return;
    }
    primaries.add(at);
    const playlists = new Set<string | undefined>([
      ...hls.variants.map((v) => pathKey(v.url)),
      ...(hls.audio ?? []).map((a) => pathKey(a.url)),
    ]);
    const files = new Set<string | undefined>((hls.mediaResources ?? []).map(pathKey));
    const masterStreamId =
      extractYouTubeStreamId(candidate.mediaUrl) ??
      hls.variants.map((v) => extractYouTubeStreamId(v.url)).find((id) => id !== undefined);
    list.forEach((other, to) => {
      const key = keys[to];
      if (to === at || claimedBy.has(to) || primaries.has(to)) {
        return;
      }
      const otherStreamId = extractYouTubeStreamId(other.mediaUrl);
      const isYtRelated =
        other.kind === 'hls' && masterStreamId !== undefined && masterStreamId === otherStreamId;
      if (
        (other.kind === 'hls' && ((key !== undefined && playlists.has(key)) || isYtRelated)) ||
        (other.kind === 'file' && key !== undefined && files.has(key))
      ) {
        claimedBy.set(to, at);
      }
    });
  });
  const entries = new Map<number, { position: number; group: CandidateGroup }>();
  list.forEach((candidate, at) => {
    if (!claimedBy.has(at)) {
      entries.set(at, { position: at, group: { primary: candidate, related: [] } });
    }
  });
  list.forEach((candidate, at) => {
    const entry = entries.get(claimedBy.get(at) ?? -1);
    if (entry) {
      entry.group.related.push(candidate);
      entry.position = Math.min(entry.position, at);
    }
  });
  const groups = [...entries.values()];
  return groups.sort((a, b) => a.position - b.position).map((entry) => entry.group);
}

/** Origem+caminho (sem consulta/fragmento) de uma URL http(s); `undefined` para o resto. */
function pathKey(url: string): string | undefined {
  try {
    const { protocol, origin, pathname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? `${origin}${pathname}` : undefined;
  } catch {
    return undefined;
  }
}

/** Identificador de stream de vídeo do YouTube (/id/<streamId>/ ou ?id=<streamId>). */
function extractYouTubeStreamId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'googlevideo.com' && !parsed.hostname.endsWith('.googlevideo.com')) {
      return undefined;
    }
    const pathMatch = /\/id\/([^/]+)/.exec(parsed.pathname);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
    const queryId = parsed.searchParams.get('id');
    if (queryId) {
      return queryId;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
