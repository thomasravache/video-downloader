import type { PageSnapshot } from '../../src/core/contracts';

/**
 * Executada NA PÁGINA por `scripting.executeScript({ func })`: precisa ser autocontida (o Chrome a
 * serializa) e devolver só dados clonáveis. Lê `<video>` (também em shadow roots abertos),
 * `video > source[src]`, `currentSrc` e DRM.
 * Não faz rede, não altera a página além de observar o evento `encrypted` para chamadas futuras.
 */
export function collectVideos(): PageSnapshot {
  const holder = window as unknown as {
    __vdEncrypted?: WeakSet<HTMLVideoElement>;
    __vdObserved?: WeakSet<HTMLVideoElement>;
  };
  const encrypted = (holder.__vdEncrypted ??= new WeakSet<HTMLVideoElement>());
  const observed = (holder.__vdObserved ??= new WeakSet<HTMLVideoElement>());

  // D3 (SPEC-0024): players em web component guardam o `<video>` num shadow root aberto. O `document` é a
  // profundidade 0; shadow roots além da 8 são ignorados (limite fixo, sem recursão sem fim).
  const maxShadowDepth = 8;
  const roots: (Document | ShadowRoot)[] = [];
  const walk = (root: Document | ShadowRoot, depth: number): void => {
    roots.push(root);
    if (depth >= maxShadowDepth) {
      return;
    }
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (element.shadowRoot) {
        walk(element.shadowRoot, depth + 1);
      }
    }
  };
  walk(document, 0);
  const all = <E extends Element>(selector: string): E[] =>
    roots.flatMap((root) => Array.from(root.querySelectorAll<E>(selector)));

  const videos = all<HTMLVideoElement>('video').map((video) => {
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
  for (const iframe of all('iframe[src]')) {
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
