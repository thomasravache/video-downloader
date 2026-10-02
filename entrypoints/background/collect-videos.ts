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

  // Origens http(s) de `<iframe src>` diferentes da deste frame. Espelha `findCrossOriginFrames`
  // (src/core/frames.ts), duplicada aqui porque esta função é serializada e não pode importar nada.
  const crossOrigins = new Set<string>();
  for (const iframe of Array.from(document.querySelectorAll('iframe[src]'))) {
    const src = iframe.getAttribute('src')?.trim() ?? '';
    if (src === '') {
      continue;
    }
    try {
      const url = new URL(src, location.href);
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.origin !== location.origin
      ) {
        crossOrigins.add(url.origin);
      }
    } catch {
      // src inválido: ignorado.
    }
  }
  return {
    pageUrl: location.href,
    pageTitle: document.title,
    videos,
    crossOriginFrames: [...crossOrigins],
  };
}
