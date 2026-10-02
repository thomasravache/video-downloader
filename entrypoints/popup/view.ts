import type { ResolveHlsResponse, VideoCandidate } from '../../src/core/contracts';
import type { HlsInfo } from '../../src/core/hls';

export interface ViewText {
  listLabel: string;
  badgeDrm: string;
  badgeUnsupported: string;
  download: string;
  downloadNamed(title: string): string;
  accessNeeded: string;
  grantAccess: string;
  accessDenied: string;
  badgeEncrypted: string;
  badgeLive: string;
  hlsLoading: string;
  hlsQuality: string;
  hlsErrorFetch: string;
  hlsErrorParse: string;
  hlsErrorGeneric: string;
  duration(formatted: string): string;
  /** Número no idioma da interface (vírgula decimal em pt-BR). */
  number(value: number): string;
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

function formatBadge(candidate: VideoCandidate): string | undefined {
  if (candidate.kind === 'hls') {
    return 'HLS';
  }
  if (candidate.kind === 'dash') {
    return 'DASH';
  }
  switch (candidate.mimeType) {
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

const hlsSlotId = (candidateId: string): string => `hls-${candidateId}`;

function unsupportedBadge(text: ViewText): HTMLElement {
  const badge = element('span', 'badge badge-warn', text.badgeUnsupported);
  badge.dataset['testid'] = 'badge-unsupported';
  return badge;
}

function fillLoading(slot: HTMLElement, text: ViewText): void {
  const skeleton = element('div', 'skeleton');
  skeleton.dataset['testid'] = 'hls-loading';
  skeleton.setAttribute('aria-busy', 'true');
  skeleton.append(
    element('span', 'skeleton-bar'),
    element('span', 'skeleton-text', text.hlsLoading),
  );
  slot.replaceChildren(skeleton);
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${s}` : `${String(m)}:${s}`;
}

/** `720p · 3,2 Mbps`; sem altura o próprio rótulo já é a banda (`800 kbps`). */
function optionText(variant: HlsInfo['variants'][number], text: ViewText): string {
  if (variant.height === undefined) {
    return variant.label;
  }
  const bandwidth =
    variant.bandwidth >= 1_000_000
      ? `${text.number(variant.bandwidth / 1_000_000)} Mbps`
      : `${String(Math.round(variant.bandwidth / 1000))} kbps`;
  return `${variant.label} · ${bandwidth}`;
}

function qualitySelect(hls: HlsInfo, candidateKey: string, text: ViewText): HTMLElement {
  const field = element('div', 'field');
  const label = element('label', 'field-label', text.hlsQuality);
  const select = element('select', 'select');
  select.id = `quality-${candidateKey}`;
  select.dataset['testid'] = 'quality-select';
  label.htmlFor = select.id;
  hls.variants.forEach((variant, position) => {
    const option = element('option', undefined, optionText(variant, text));
    option.value = String(variant.index);
    option.selected = position === 0;
    select.append(option);
  });
  field.append(label, select);
  return field;
}

/** Estado resolvido: protegido, ao vivo, ou seletor de qualidade (a mais alta já escolhida). */
function fillHls(slot: HTMLElement, hls: HlsInfo, text: ViewText): void {
  if (hls.encrypted) {
    const badge = element('span', 'badge badge-warn', text.badgeEncrypted);
    badge.dataset['testid'] = 'badge-encrypted';
    slot.replaceChildren(badge);
    return;
  }
  if (hls.live) {
    const badge = element('span', 'badge badge-warn', text.badgeLive);
    badge.dataset['testid'] = 'badge-live';
    slot.replaceChildren(badge);
    return;
  }
  const parts: HTMLElement[] = [];
  if (hls.durationSec !== undefined) {
    parts.push(element('p', 'status', text.duration(formatDuration(hls.durationSec))));
  }
  if (hls.variants.length > 0) {
    parts.push(qualitySelect(hls, slot.id, text));
  }
  slot.replaceChildren(...parts, unsupportedBadge(text));
}

/** Aplica a resposta de `resolveHls` ao cartão do candidato (ignora se o cartão já saiu da tela). */
export function renderHlsResult(
  container: HTMLElement,
  candidateId: string,
  response: ResolveHlsResponse | undefined,
  text: ViewText,
): void {
  const slot = container.querySelector<HTMLElement>(`#${hlsSlotId(candidateId)}`);
  if (!slot) {
    return;
  }
  if (response?.ok === true) {
    fillHls(slot, response.hls, text);
    return;
  }
  const message = element(
    'p',
    'status status-error',
    response?.error === 'HLS_FETCH_FAILED'
      ? text.hlsErrorFetch
      : response?.error === 'HLS_PARSE_FAILED'
        ? text.hlsErrorParse
        : text.hlsErrorGeneric,
  );
  message.dataset['testid'] = 'hls-error';
  slot.replaceChildren(message, unsupportedBadge(text));
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
  const format = formatBadge(candidate);
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
  } else if (candidate.kind === 'hls') {
    // HLS nunca tem botão de download aqui (SPEC-0012); o estado da playlist vive neste espaço.
    const slot = element('div', 'hls');
    slot.id = hlsSlotId(candidate.id);
    slot.setAttribute('aria-live', 'polite');
    if (candidate.hls) {
      fillHls(slot, candidate.hls, text);
    } else {
      fillLoading(slot, text);
    }
    item.append(slot);
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
