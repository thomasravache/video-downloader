import type { ResolveHlsResponse, VideoCandidate } from '../../src/core/contracts';
import type { HlsInfo } from '../../src/core/hls';
import type { CandidateGroup } from '../../src/core/candidates';
import type { JobState } from '../../src/core/hls-download';
import { audioIncludedText, audioOptions } from './audio';
import { syncChildren } from './dom';

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
  /** Rótulo do seletor de áudio (SPEC-0015). */
  audioLabel: string;
  /** "Outras fontes (N)" (SPEC-0015). */
  relatedSources(count: number): string;
  hlsErrorFetch: string;
  hlsErrorParse: string;
  hlsErrorGeneric: string;
  duration(formatted: string): string;
  /** "Inclui áudio: <nome>" (SPEC-0014). */
  audioIncluded(name: string): string;
  progressLabel: string;
  cancelDownload: string;
  retryDownload: string;
  redownload: string;
  jobAssembling: string;
  jobSaving: string;
  jobCanceled: string;
  jobSegments(done: number, total: number): string;
  jobSaved(filename: string): string;
  /** Mensagem traduzida de `JobState.error`. */
  jobError(error: string | undefined): string;
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

/** Nome mostrado do vídeo: o título ou o último trecho do caminho da URL. */
export function candidateLabel(candidate: VideoCandidate): string {
  return candidate.title ?? sourceLabel(candidate.mediaUrl);
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

/** Como o popup inicia um download HLS: a escolha da qualidade e o espaço do progresso. */
export interface HlsContext {
  candidateId: string;
  label: string;
  onStart(
    variantIndex: number,
    audioIndex: number | undefined,
    area: HTMLElement,
    selects: HTMLSelectElement[],
  ): void;
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

function audioField(slotId: string, text: ViewText): HTMLElement {
  const field = element('div', 'field');
  const label = element('label', 'field-label', text.audioLabel);
  const select = element('select', 'select');
  select.id = `audio-${slotId}`;
  select.dataset['testid'] = 'audio-select';
  label.htmlFor = select.id;
  field.append(label, select);
  return field;
}

const TERMINAL: readonly JobState['state'][] = ['done', 'error', 'canceled'];
export const isTerminalJob = (job: JobState): boolean => TERMINAL.includes(job.state);

export interface JobView {
  element: HTMLElement;
  update(job: JobState): void;
  /** Falha antes de existir um job (resposta de recusa do `download`). */
  fail(message: string): void;
}

/** Progresso de um job: criado uma vez e atualizado no lugar (o foco do teclado não se perde). */
export function createJobView(text: ViewText, onCancel: () => void, onRetry: () => void): JobView {
  const root = element('div', 'job');
  const progress = element('div', 'progress');
  progress.dataset['testid'] = 'download-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', text.progressLabel);
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', '0');
  progress.dataset['state'] = 'queued';
  const fill = element('div', 'progress-fill');
  progress.append(fill);

  const status = element('p', 'status');
  status.setAttribute('role', 'status');
  const actions = element('div', 'job-actions');
  const cancel = element('button', 'button button-secondary', text.cancelDownload);
  cancel.type = 'button';
  cancel.dataset['testid'] = 'cancel-download';
  cancel.setAttribute('aria-label', text.cancelDownload);
  cancel.addEventListener('click', () => {
    cancel.disabled = true;
    onCancel();
  });
  const retry = element('button', 'button');
  retry.type = 'button';
  retry.dataset['testid'] = 'retry-download';
  retry.addEventListener('click', onRetry);
  const error = element('p', 'status status-error');
  error.dataset['testid'] = 'job-error';

  actions.append(cancel);
  root.append(progress, status, actions);

  function showError(message: string): void {
    error.textContent = message;
    if (!error.isConnected) {
      root.insertBefore(error, actions);
    }
  }

  return {
    element: root,
    update(job) {
      progress.setAttribute('aria-valuenow', String(Math.round(job.percent)));
      progress.dataset['state'] = job.state;
      fill.style.width = `${String(Math.round(job.percent))}%`;
      switch (job.state) {
        case 'queued':
        case 'running':
          status.textContent = text.jobSegments(job.segmentsDone, job.segmentsTotal);
          break;
        case 'assembling':
          status.textContent = text.jobAssembling;
          break;
        case 'saving':
          status.textContent = text.jobSaving;
          break;
        case 'done':
          status.textContent = text.jobSaved(job.filename ?? '');
          break;
        case 'canceled':
          status.textContent = text.jobCanceled;
          break;
        case 'error':
          status.textContent = '';
          showError(text.jobError(job.error));
          break;
      }
      if (isTerminalJob(job)) {
        cancel.remove();
        if (job.state !== 'done') {
          retry.textContent = job.state === 'error' ? text.retryDownload : text.redownload;
          actions.replaceChildren(retry);
        }
      }
    },
    fail(message) {
      progress.remove();
      status.remove();
      cancel.remove();
      showError(message);
      retry.textContent = text.retryDownload;
      actions.replaceChildren(retry);
    },
  };
}

function downloadButton(context: HlsContext, text: ViewText): HTMLButtonElement {
  const button = element('button', 'button', text.download);
  button.type = 'button';
  button.dataset['testid'] = 'download-button';
  button.setAttribute('aria-label', text.downloadNamed(context.label));
  return button;
}

/** Estado resolvido: protegido, ao vivo, ou seletor de qualidade + Baixar (a mais alta já escolhida). */
function fillHls(slot: HTMLElement, hls: HlsInfo, text: ViewText, context: HlsContext): void {
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
  const field = hls.variants.length > 0 ? qualitySelect(hls, slot.id, text) : undefined;
  if (field) {
    parts.push(field);
  }
  const select = field?.querySelector('select') ?? undefined;
  // SPEC-0015: seletor "Áudio" só quando o grupo da variante escolhida tem mais de uma faixa; opções
  // recalculadas ao trocar a qualidade. Com uma faixa fica o aviso "Inclui áudio" da SPEC-0014 (só texto).
  const audioBox = audioField(slot.id, text);
  const audioSelect = audioBox.querySelector('select') as HTMLSelectElement;
  const audioNote = element('p', 'status');
  audioNote.dataset['testid'] = 'audio-included';
  const refreshAudio = (): void => {
    const variant = Number(select?.value ?? 0);
    const options = audioOptions(hls, variant);
    audioSelect.replaceChildren(
      ...options.map((entry) => {
        const option = element('option', undefined, entry.label);
        option.value = String(entry.index);
        option.selected = entry.default;
        return option;
      }),
    );
    audioBox.hidden = options.length === 0;
    const note =
      options.length > 0
        ? undefined
        : audioIncludedText(hls, variant, (name) => text.audioIncluded(name));
    audioNote.textContent = note ?? '';
    audioNote.hidden = note === undefined;
  };
  refreshAudio();
  select?.addEventListener('change', refreshAudio);
  parts.push(audioBox, audioNote);
  const area = element('div', 'job-area');
  const button = downloadButton(context, text);
  button.addEventListener('click', () => {
    const audioIndex = audioBox.hidden ? undefined : Number(audioSelect.value);
    context.onStart(
      Number(select?.value ?? 0),
      audioIndex,
      area,
      [select, audioBox.hidden ? undefined : audioSelect].filter(
        (item): item is HTMLSelectElement => item !== undefined,
      ),
    );
  });
  area.append(button);
  slot.replaceChildren(...parts, area);
}

/** Aplica a resposta de `resolveHls` ao cartão do candidato (ignora se o cartão já saiu da tela). */
export function renderHlsResult(
  container: HTMLElement,
  candidateId: string,
  response: ResolveHlsResponse | undefined,
  text: ViewText,
  context: HlsContext,
): void {
  const slot = container.querySelector<HTMLElement>(`#${hlsSlotId(candidateId)}`);
  if (!slot) {
    return;
  }
  if (response?.ok === true) {
    fillHls(slot, response.hls, text, context);
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
  hlsContext: (candidate: VideoCandidate) => HlsContext,
): HTMLLIElement {
  const label = candidateLabel(candidate);
  const item = element('li', 'card');
  item.dataset['testid'] = 'candidate-item';
  item.dataset['candidateId'] = candidate.id;
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
    // O estado da playlist (e, resolvida e limpa, o Baixar com o progresso) vive neste espaço.
    const slot = element('div', 'hls');
    slot.id = hlsSlotId(candidate.id);
    slot.setAttribute('aria-live', 'polite');
    if (candidate.hls) {
      fillHls(slot, candidate.hls, text, hlsContext(candidate));
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
  groups: CandidateGroup[],
  text: ViewText,
  onDownload: (candidate: VideoCandidate, button: HTMLButtonElement) => void,
  hlsContext: (candidate: VideoCandidate) => HlsContext,
): void {
  const list = element('ul', 'list');
  list.dataset['testid'] = 'candidate-list';
  list.setAttribute('aria-label', text.listLabel);
  list.append(
    ...groups.flatMap((group) =>
      [group.primary, ...group.related].map((candidate) =>
        renderCard(candidate, text, onDownload, hlsContext),
      ),
    ),
  );
  container.replaceChildren(list);
  applyGroups(container, groups, text);
}

/**
 * Posiciona os cartões (já no DOM) conforme os grupos: o primary no nível da lista e os `related` dentro de
 * `<details data-testid="related-sources">` fechado por padrão, sob o primary (SPEC-0015). Só MOVE os nós que precisam
 * (`syncChildren`), então o estado dos cartões (resolve, progresso, seleção) e o `open` do details são preservados.
 */
export function applyGroups(
  container: HTMLElement,
  groups: CandidateGroup[],
  text: ViewText,
): void {
  const list = container.querySelector<HTMLElement>('[data-testid="candidate-list"]');
  if (!list) {
    return;
  }
  const cards = new Map<string, HTMLElement>();
  for (const node of container.querySelectorAll<HTMLElement>('li[data-candidate-id]')) {
    cards.set(node.dataset['candidateId'] ?? '', node);
  }
  const primaries: HTMLElement[] = [];
  for (const group of groups) {
    const card = cards.get(group.primary.id);
    if (!card) {
      continue;
    }
    primaries.push(card);
    let details = card.querySelector<HTMLDetailsElement>(':scope > details.related');
    if (group.related.length === 0) {
      details?.remove();
      continue;
    }
    if (!details) {
      details = element('details', 'related');
      details.dataset['testid'] = 'related-sources';
      details.append(element('summary', 'related-summary'), element('ul', 'list'));
      card.append(details);
    }
    (details.querySelector('summary') as HTMLElement).textContent = text.relatedSources(
      group.related.length,
    );
    syncChildren(
      details.querySelector('ul') as HTMLElement,
      group.related.flatMap((candidate) => cards.get(candidate.id) ?? []),
    );
  }
  // Só depois de tirar os `related` da lista: o primary que já está no lugar não é movido.
  syncChildren(list, primaries);
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
