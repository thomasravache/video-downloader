import { candidatesOfSnapshot } from '../../core/extract';
import { mergeFrameSnapshots } from '../../core/frames';
import type { DetectContext, PageSnapshot, Provider, VideoCandidate } from '../../core/contracts';

/** Candidatos do frame principal (frameId 0); `detect` usa mergeFrameSnapshots para todos os frames. */
export function extractCandidates(snapshot: PageSnapshot, tabId: number): VideoCandidate[] {
  return candidatesOfSnapshot(snapshot, tabId, 0);
}

const provider: Provider = {
  id: 'generic',
  flavors: ['public', 'local'],
  matches: () => true,
  async detect(ctx: DetectContext) {
    return mergeFrameSnapshots(await ctx.scripting.collectVideos(ctx.tabId), ctx.tabId);
  },
};

export default provider;
