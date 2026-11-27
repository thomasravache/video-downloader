import type {
  CancelResponse,
  DetectResponse,
  DiagnosticsResponse,
  DownloadResponse,
  JobResponse,
  NetworkRevisionResponse,
  ResolveHlsResponse,
  VideoCandidate,
} from '../../src/core/contracts';
import { requestAccess } from '../../src/core/access';
import { groupCandidates, hideRedundantCandidates } from '../../src/core/candidates';
import type { PermissionsPort } from '../../src/core/access';
import { createDiagnostics } from '../../src/core/diagnostics';
import { validateJobResponse } from '../../src/core/hls-download';
import { createRedetectController } from './redetect';
import {
  applyGroups,
  candidateLabel,
  createJobView,
  isTerminalJob,
  renderAccess,
  renderCandidates,
  renderHlsResult,
  setStatus,
  showAccessDenied,
  showDetectFailed,
  showMessage,
} from './view';
import type { HlsContext, ViewText } from './view';

const t = (key: string, ...substitutions: string[]): string =>
  browser.i18n.getMessage(key as never, substitutions);

const text: ViewText = {
  listLabel: t('listLabel'),
  badgeDrm: t('badgeDrm'),
  badgeUnsupported: t('badgeUnsupported'),
  download: t('buttonDownload'),
  downloadNamed: (title) => t('buttonDownloadNamed', title),
  accessNeeded: t('accessNeeded'),
  grantAccess: t('buttonGrantAccess'),
  accessDenied: t('accessDenied'),
  badgeEncrypted: t('badgeEncrypted'),
  badgeLive: t('badgeLive'),
  aes128Note: t('aes128Note'),
  hlsLoading: t('hlsLoading'),
  hlsQuality: t('hlsQuality'),
  audioLabel: t('audioLabel'),
  relatedSources: (count) => t('relatedSources', String(count)),
  hlsErrorFetch: t('hlsErrorFetch'),
  hlsErrorParse: t('hlsErrorParse'),
  hlsErrorGeneric: t('hlsErrorGeneric'),
  hlsErrorExpired: t('hlsErrorExpired'),
  duration: (formatted) => t('hlsDuration', formatted),
  audioIncluded: (name) => t('audioIncluded', name),
  progressLabel: t('jobProgressLabel'),
  cancelDownload: t('buttonCancelDownload'),
  retryDownload: t('buttonRetryDownload'),
  redownload: t('buttonRedownload'),
  jobAssembling: t('jobAssembling'),
  jobSaving: t('jobSaving'),
  jobCanceled: t('jobCanceled'),
  jobSegments: (done, total) => t('jobSegments', String(done), String(total)),
  jobSaved: (filename) => t('jobSaved', filename),
  jobError: (error) => t(`jobError${error ?? 'ASSEMBLY_FAILED'}`),
  number: (value) =>
    new Intl.NumberFormat(browser.i18n.getUILanguage(), { maximumFractionDigits: 1 }).format(value),
};

/** `browser.permissions` do próprio popup: `permissions.request` exige o gesto do usuário (ADR-0012). */
const permissions: PermissionsPort = {
  contains: (origins) => browser.permissions.contains({ origins }),
  request: (origins) => browser.permissions.request({ origins }),
};

const title = document.getElementById('title');
const content = document.getElementById('content');
const access = document.getElementById('access');
const footerStatus = document.getElementById('footer-status');
const copyButton = document.getElementById('copy-diagnostics');
const redetectButton = document.getElementById('redetect');
/** Diagnóstico do próprio popup (`popup.detect_failed`): o background pode nem estar respondendo. */
const popupDiagnostics = createDiagnostics();
/** Candidatos desenhados agora (reagrupamento após o resolve e cartões de job preservados). */
let shown = new Map<string, VideoCandidate>();
/** Candidatos com job de download HLS em andamento: a re-detecção nunca os redesenha (SPEC-0024). */
const running = new Set<string>();

document.documentElement.lang = browser.i18n.getUILanguage();
if (title) {
  title.textContent = t('extName');
}
if (copyButton) {
  copyButton.textContent = t('buttonCopyDiagnostics');
}
if (redetectButton) {
  redetectButton.textContent = t('buttonRedetect');
}

async function targetTabId(): Promise<number | undefined> {
  const fromUrl = new URLSearchParams(location.search).get('tabId');
  if (fromUrl !== null && /^\d+$/.test(fromUrl)) {
    return Number(fromUrl);
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function downloadError(response: Exclude<DownloadResponse, { ok: true }>): string {
  switch (response.error) {
    case 'DOWNLOAD_FAILED':
      return t('statusDownloadFailed', response.reason);
    case 'CANDIDATE_NOT_FOUND':
      return t('errorCandidateNotFound');
    case 'PROTECTED':
      return t('errorProtected');
    case 'UNSUPPORTED':
      return t('errorUnsupported');
    case 'HLS_NOT_RESOLVED':
      return t('errorHlsNotResolved');
    case 'ENCRYPTED':
      return t('jobErrorENCRYPTED');
    case 'LIVE':
      return t('jobErrorLIVE');
    case 'JOB_ALREADY_RUNNING':
      return t('errorJobRunning');
    case 'TOO_MANY_JOBS':
      return t('errorTooManyJobs');
    case 'INVALID_MESSAGE':
    default:
      return t('errorGeneric');
  }
}

const POLL_MS = 400;
const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Download de HLS: cria o job, mostra o progresso (polling ≥ 2×/s) e permite cancelar. */
function startHls(
  candidateId: string,
  variantIndex: number,
  audioIndex: number | undefined,
  area: HTMLElement,
  selects: HTMLSelectElement[],
): void {
  let jobId: string | undefined;
  const view = createJobView(
    text,
    () => {
      if (jobId !== undefined) {
        void browser.runtime
          .sendMessage<unknown, CancelResponse | undefined>({ type: 'cancel', jobId })
          .catch(() => undefined);
      }
    },
    () => {
      startHls(candidateId, variantIndex, audioIndex, area, selects);
    },
  );
  area.replaceChildren(view.element);
  for (const select of selects) {
    select.disabled = true;
  }
  running.add(candidateId);

  void (async () => {
    try {
      const started = await browser.runtime.sendMessage<unknown, DownloadResponse | undefined>({
        type: 'download',
        candidateId,
        variantIndex,
        ...(audioIndex !== undefined && { audioIndex }),
      });
      if (started?.ok !== true || !('jobId' in started)) {
        view.fail(started && !started.ok ? downloadError(started) : t('errorGeneric'));
        return;
      }
      jobId = started.jobId;
      for (;;) {
        const response = await browser.runtime.sendMessage<unknown, JobResponse | undefined>({
          type: 'job',
          jobId,
        });
        const valid = validateJobResponse(response);
        if (!valid.ok || !valid.value.ok) {
          view.fail(t('errorGeneric'));
          return;
        }
        view.update(valid.value.job);
        if (isTerminalJob(valid.value.job)) {
          return;
        }
        await wait(POLL_MS);
      }
    } catch {
      view.fail(t('errorGeneric'));
    } finally {
      running.delete(candidateId);
      for (const select of selects) {
        select.disabled = false;
      }
    }
  })();
}

function hlsContext(candidate: VideoCandidate): HlsContext {
  return {
    candidateId: candidate.id,
    label: candidateLabel(candidate),
    onStart: (variantIndex, audioIndex, area, selects) => {
      startHls(candidate.id, variantIndex, audioIndex, area, selects);
    },
  };
}

async function download(candidate: VideoCandidate, button: HTMLButtonElement): Promise<void> {
  const status = document.getElementById(`status-${candidate.id}`);
  button.disabled = true;
  const response = await browser.runtime.sendMessage<unknown, DownloadResponse | undefined>({
    type: 'download',
    candidateId: candidate.id,
  });
  button.disabled = false;
  if (!status) {
    return;
  }
  if (response?.ok === true) {
    setStatus(status, t('statusDownloadStarted'), false);
  } else {
    setStatus(status, response ? downloadError(response) : t('errorGeneric'), true);
  }
}

function grantAccess(origins: string[], button: HTMLButtonElement): void {
  if (!access) {
    return;
  }
  button.disabled = true;
  // Chamada direta no handler do clique: preserva o gesto do usuário.
  void requestAccess(permissions, origins).then(({ granted }) => {
    if (granted) {
      void redetect.redetect();
    } else {
      button.disabled = false;
      showAccessDenied(access, text.accessDenied);
    }
  });
}

/** Uma mensagem `resolveHls` por cartão HLS ainda sem `hls`; cada falha fica no próprio cartão. */
function resolvePlaylists(container: HTMLElement, candidates: VideoCandidate[]): void {
  for (const candidate of candidates) {
    if (candidate.kind !== 'hls' || candidate.hls || candidate.protection === 'drm') {
      continue;
    }
    void browser.runtime
      .sendMessage<unknown, ResolveHlsResponse | undefined>({
        type: 'resolveHls',
        candidateId: candidate.id,
      })
      .catch(() => undefined)
      .then((response) => {
        renderHlsResult(container, candidate.id, response, text, hlsContext(candidate));
        if (response?.ok === true && shown.has(candidate.id)) {
          // SPEC-0015: a master resolvida passa a reivindicar variantes/arquivos; reagrupa (só move cartões).
          shown.set(candidate.id, { ...candidate, hls: response.hls });
          applyGroups(container, groupCandidates([...shown.values()]), text);
        }
      });
  }
}

/** `detect` da aba alvo; rejeita quando o background não responde (o controlador trata). */
async function requestDetect(): Promise<DetectResponse | undefined> {
  content?.setAttribute('aria-busy', 'true');
  const tabId = await targetTabId();
  return tabId === undefined
    ? undefined
    : browser.runtime.sendMessage<unknown, DetectResponse | undefined>({ type: 'detect', tabId });
}

async function requestRevision(): Promise<number | undefined> {
  const tabId = await targetTabId();
  if (tabId === undefined) {
    return undefined;
  }
  const response = await browser.runtime.sendMessage<unknown, NetworkRevisionResponse | undefined>({
    type: 'network-revision',
    tabId,
  });
  return response?.ok === true ? response.revision : undefined;
}

/** Estado sem lista (vazio, restrito): não redesenha o mesmo estado (o `aria-live` não repete o aviso). */
function showState(container: HTMLElement, message: string, testId: string): void {
  if (container.querySelector(`:scope > [data-testid="${testId}"]`) === null) {
    showMessage(container, message, testId);
  }
}

let shownOrigins = '';

/**
 * Desenha a resposta de `detect`. `preserve` (SPEC-0024 D4): cartões que ficam como estão. Um cartão com job
 * em andamento continua na tela mesmo que a nova lista não o traga.
 */
function renderDetect(response: DetectResponse | undefined, preserve: ReadonlySet<string>): void {
  if (!content || !access) {
    return;
  }
  content.setAttribute('aria-busy', 'false');
  const origins = response?.ok === true ? response.access.blockedOrigins : [];
  if (JSON.stringify(origins) !== shownOrigins) {
    shownOrigins = JSON.stringify(origins);
    renderAccess(access, origins, text, (button) => {
      grantAccess(origins, button);
    });
  }

  const fresh = response?.ok === true ? response.candidates : [];
  const ids = new Set(fresh.map((c) => c.id));
  const jobs = [...running].flatMap((id) => {
    const candidate = shown.get(id);
    return candidate && !ids.has(id) ? [candidate] : [];
  });
  const candidates = [...fresh, ...jobs];
  shown = new Map(candidates.map((c) => [c.id, c]));

  if (candidates.length > 0) {
    const groups = groupCandidates(candidates);
    renderCandidates(
      content,
      groups,
      text,
      (candidate, button) => {
        void download(candidate, button);
      },
      hlsContext,
      preserve,
    );
    resolvePlaylists(
      content,
      hideRedundantCandidates(candidates).filter((c) => !preserve.has(c.id)),
    );
  } else if (response?.ok === true && origins.length > 0) {
    content.replaceChildren();
  } else if (response?.ok === true) {
    showState(content, t('popupEmpty'), 'empty-state');
  } else if (response?.error === 'RESTRICTED_PAGE') {
    showState(content, t('popupRestricted'), 'restricted-state');
  } else {
    showFailed(() => {
      void redetect.redetect();
    });
  }
}

/** D2: `detect` falhou. Com um job em andamento o cartão fica e o aviso vai para o rodapé. */
function showFailed(retry: () => void): void {
  if (!content) {
    return;
  }
  content.setAttribute('aria-busy', 'false');
  if (running.size > 0 && footerStatus) {
    setStatus(footerStatus, t('popupDetectFailed'), true);
    return;
  }
  shown = new Map();
  showDetectFailed(content, t('popupDetectFailed'), t('buttonDetectRetry'), retry);
}

const redetect = createRedetectController({
  detect: requestDetect,
  revision: requestRevision,
  view: { render: renderDetect, showFailed },
  busy: () => running,
  log: (event, fields) => {
    popupDiagnostics.log('warn', event, popupDiagnostics.newCorrelationId(), fields);
  },
});

async function copyDiagnostics(): Promise<void> {
  if (!footerStatus) {
    return;
  }
  try {
    const response = await browser.runtime.sendMessage<unknown, DiagnosticsResponse | undefined>({
      type: 'diagnostics',
    });
    if (response?.ok !== true) {
      throw new Error('diagnostics');
    }
    const popupEntries = popupDiagnostics.snapshot().filter((entry) => entry.event !== 'counters');
    await navigator.clipboard.writeText(
      JSON.stringify([...response.entries, ...popupEntries], null, 2),
    );
    setStatus(footerStatus, t('statusDiagnosticsCopied'), false);
  } catch {
    setStatus(footerStatus, t('statusDiagnosticsFailed'), true);
  }
}

copyButton?.addEventListener('click', () => {
  void copyDiagnostics();
});
redetectButton?.addEventListener('click', () => {
  void redetect.redetect();
});
if (content) {
  showMessage(content, t('popupSearching'), 'popup-loading');
}
window.addEventListener('pagehide', () => {
  redetect.stop();
});
void redetect.start();
