import { candidateId } from '../../core/candidates';
import { classify } from '../../core/classify';
import type { DetectContext, PageSnapshot, Provider, VideoCandidate } from '../../core/contracts';

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
};

function mimeTypeOf(mediaUrl: string): string | undefined {
  if (!/^https?:\/\//i.test(mediaUrl)) {
    return undefined;
  }
  const path = mediaUrl.split(/[?#]/)[0] ?? '';
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext === undefined ? undefined : MIME_BY_EXTENSION[ext];
}

/** Converte o retrato da página em candidatos (um por URL distinta, sem duplicar `currentSrc`). */
export function extractCandidates(snapshot: PageSnapshot, tabId: number): VideoCandidate[] {
  const found = new Map<string, VideoCandidate>();
  const title = snapshot.pageTitle.trim() === '' ? undefined : snapshot.pageTitle;

  for (const video of snapshot.videos) {
    const urls = [video.src, video.currentSrc, ...video.sources];
    for (const mediaUrl of urls) {
      if (mediaUrl === null || mediaUrl === '') {
        continue;
      }
      const classification = classify({
        mediaUrl,
        hasMediaKeys: video.hasMediaKeys,
        encrypted: video.encrypted,
      });
      const existing = found.get(mediaUrl);
      if (existing) {
        // A mesma URL em dois elementos: basta um estar protegido para o candidato ser protegido.
        if (classification.protection === 'drm') {
          existing.protection = 'drm';
        }
        continue;
      }
      const mimeType = mimeTypeOf(mediaUrl);
      found.set(mediaUrl, {
        id: candidateId(tabId, mediaUrl),
        providerId: 'generic',
        tabId,
        pageUrl: snapshot.pageUrl,
        mediaUrl,
        ...(title !== undefined && { title }),
        ...(mimeType !== undefined && { mimeType }),
        ...classification,
      });
    }
  }
  return [...found.values()];
}

const provider: Provider = {
  id: 'generic',
  flavors: ['public', 'local'],
  matches: () => true,
  async detect(ctx: DetectContext) {
    return extractCandidates(await ctx.scripting.collectVideos(ctx.tabId), ctx.tabId);
  },
};

export default provider;
