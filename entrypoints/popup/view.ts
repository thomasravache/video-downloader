import type { VideoCandidate } from '../../src/core/contracts';

export interface ViewText {
  listLabel: string;
  badgeDrm: string;
  badgeUnsupported: string;
  download: string;
  downloadNamed(title: string): string;
  accessNeeded: string;
  grantAccess: string;
  accessDenied: string;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (textContent !== undefined) {
    node.textContent = textContent;
  }
  return node;
}

/** Texto de estado (vazio, restrito, erro) com `data-testid` próprio. */
export function showMessage(container: HTMLElement, message: string, testId: string): void {
  const paragraph = element('p', 'message', message);
  paragraph.dataset['testid'] = testId;
  container.replaceChildren(paragraph);
}

export function setStatus(node: HTMLElement, message: string, isError: boolean): void {
  node.textContent = message;
  node.classList.toggle('status-error', isError);
}

function formatBadge(mimeType: string | undefined): string | undefined {
  switch (mimeType) {
    case 'video/mp4':
      return 'MP4';
    case 'video/webm':
      return 'WebM';
    case 'video/ogg':
      return 'Ogg';
    case 'video/quicktime':
      return 'MOV';
    case 'video/x-matroska':
      return 'MKV';
    default:
      return undefined;
  }
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024)).toString()} KB`;
}

/** Última parte do caminho da URL (sem query), para distinguir vídeos com o mesmo título. */
function sourceLabel(mediaUrl: string): string {
  if (!/^https?:/i.test(mediaUrl)) {
    return 'blob';
  }
  try {
    const url = new URL(mediaUrl);
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? url.host);
  } catch {
    return mediaUrl;
  }
}

function renderCard(
  candidate: VideoCandidate,
  text: ViewText,
  onDownload: (candidate: VideoCandidate, button: HTMLButtonElement) => void,
): HTMLLIElement {
  const label = candidate.title ?? sourceLabel(candidate.mediaUrl);
  const item = element('li', 'card');
  item.dataset['testid'] = 'candidate-item';
  item.append(element('p', 'card-title', label));

  const meta = element('div', 'card-meta');
  const format = formatBadge(candidate.mimeType);
  if (format !== undefined) {
    meta.append(element('span', 'badge', format));
  }
  if (candidate.sizeBytes !== undefined) {
    meta.append(element('span', undefined, formatSize(candidate.sizeBytes)));
  }
  meta.append(element('span', 'card-source', sourceLabel(candidate.mediaUrl)));
  item.append(meta);

  if (candidate.protection === 'drm') {
    const badge = element('span', 'badge badge-warn', text.badgeDrm);
    badge.dataset['testid'] = 'badge-drm';
    item.append(badge);
  } else if (candidate.support === 'unsupported-stream') {
    const badge = element('span', 'badge badge-warn', text.badgeUnsupported);
    badge.dataset['testid'] = 'badge-unsupported';
    item.append(badge);
  } else {
    const button = element('button', 'button', text.download);
    button.type = 'button';
    button.dataset['testid'] = 'download-button';
    button.setAttribute('aria-label', text.downloadNamed(label));
    button.addEventListener('click', () => {
      onDownload(candidate, button);
    });
    item.append(button);
  }

  const status = element('p', 'status');
  status.id = `status-${candidate.id}`;
  status.setAttribute('role', 'status');
  item.append(status);
  return item;
}

export function renderCandidates(
  container: HTMLElement,
  candidates: VideoCandidate[],
  text: ViewText,
  onDownload: (candidate: VideoCandidate, button: HTMLButtonElement) => void,
): void {
  const list = element('ul', 'list');
  list.dataset['testid'] = 'candidate-list';
  list.setAttribute('aria-label', text.listLabel);
  list.append(...candidates.map((candidate) => renderCard(candidate, text, onDownload)));
  container.replaceChildren(list);
}

/** Bloco "acesso necessário" (origens de iframe sem permissão + botão); vazio esconde o bloco. */
export function renderAccess(
  container: HTMLElement,
  origins: readonly string[],
  text: ViewText,
  onGrant: (button: HTMLButtonElement) => void,
): void {
  if (origins.length === 0) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  const block = element('div', 'access-block');
  block.dataset['testid'] = 'access-needed';
  const heading = element('p', 'access-title', text.accessNeeded);
  heading.id = 'access-title';
  const list = element('ul', 'access-list');
  list.setAttribute('aria-labelledby', 'access-title');
  for (const origin of origins) {
    const item = element('li', 'access-origin', origin);
    item.dataset['testid'] = 'access-origin';
    list.append(item);
  }
  const button = element('button', 'button', text.grantAccess);
  button.type = 'button';
  button.dataset['testid'] = 'grant-access';
  button.addEventListener('click', () => {
    onGrant(button);
  });
  const denied = element('p', 'status status-error');
  denied.id = 'access-status';
  denied.setAttribute('role', 'status');
  block.append(heading, list, button, denied);
  container.replaceChildren(block);
  container.hidden = false;
}

/** Mensagem de acesso negado dentro do bloco de acesso. */
export function showAccessDenied(container: HTMLElement, message: string): void {
  const status = container.querySelector<HTMLElement>('#access-status');
  if (status) {
    status.textContent = message;
    status.dataset['testid'] = 'access-denied';
  }
}
