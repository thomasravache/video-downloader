/**
 * Contrato usado (SPEC-0005:UT-01):
 *   src/core/classify.ts  -> classify({ mediaUrl, hasMediaKeys, encrypted }): { support, protection }
 */
import { describe, expect, it } from 'vitest';
import { classify } from '../../src/core/classify';

const base = { hasMediaKeys: false, encrypted: false };

describe('classify', () => {
  it('SPEC-0005:UT-01 URL http(s) sem DRM é downloadable/none', () => {
    expect(classify({ ...base, mediaUrl: 'https://cdn.example.test/a.mp4' })).toEqual({
      support: 'downloadable',
      protection: 'none',
    });
    expect(classify({ ...base, mediaUrl: 'http://cdn.example.test/a.webm' })).toEqual({
      support: 'downloadable',
      protection: 'none',
    });
  });

  it('SPEC-0005:UT-01 URL blob: (MediaSource) é unsupported-stream/none', () => {
    expect(classify({ ...base, mediaUrl: 'blob:https://site.example.test/3f1c-uuid' })).toEqual({
      support: 'unsupported-stream',
      protection: 'none',
    });
  });

  it('SPEC-0005:UT-01 video.mediaKeys definido marca protection drm', () => {
    const result = classify({
      mediaUrl: 'https://cdn.example.test/a.mp4',
      hasMediaKeys: true,
      encrypted: false,
    });
    expect(result.protection).toBe('drm');
  });

  it('SPEC-0005:UT-01 evento encrypted observado marca protection drm', () => {
    const result = classify({
      mediaUrl: 'https://cdn.example.test/a.mp4',
      hasMediaKeys: false,
      encrypted: true,
    });
    expect(result.protection).toBe('drm');
  });
});
