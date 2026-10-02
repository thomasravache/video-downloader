import type { PageSnapshot } from '../../src/core/contracts';

/**
 * Executada NA PÁGINA por `scripting.executeScript({ func })`: precisa ser autocontida (o Chrome a
 * serializa) e devolver só dados clonáveis. Lê `<video>`, `video > source[src]`, `currentSrc` e DRM.
 * Não faz rede, não altera a página além de observar o evento `encrypted` para chamadas futuras.
 */
export function collectVideos(): PageSnapshot {
  const holder = window as unknown as {
    __vdEncrypted?: WeakSet<HTMLVideoElement>;
    __vdObserved?: WeakSet<HTMLVideoElement>;
  };
  const encrypted = (holder.__vdEncrypted ??= new WeakSet<HTMLVideoElement>());
  const observed = (holder.__vdObserved ??= new WeakSet<HTMLVideoElement>());

  const videos = Array.from(document.querySelectorAll('video')).map((video) => {
    if (!observed.has(video)) {
      observed.add(video);
      video.addEventListener('encrypted', () => {
        encrypted.add(video);
      });
    }
    return {
      src: video.src === '' ? null : video.src,
      currentSrc: video.currentSrc,
      sources: Array.from(video.querySelectorAll<HTMLSourceElement>(':scope > source[src]')).map(
        (source) => source.src,
      ),
      hasMediaKeys: video.mediaKeys !== null,
      encrypted: encrypted.has(video),
    };
  });
  return { pageUrl: location.href, pageTitle: document.title, videos };
}
