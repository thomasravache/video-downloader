import type {
  CancelResponse,
  DetectResponse,
  DiagnosticsResponse,
  DownloadResponse,
  JobResponse,
  ResolveHlsResponse,
  VideoCandidate,
} from '../../src/core/contracts';
import { requestAccess } from '../../src/core/access';
import { groupCandidates, hideRedundantCandidates } from '../../src/core/candidates';
import type { PermissionsPort } from '../../src/core/access';
import { validateJobResponse } from '../../src/core/hls-download';
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

document.documentElement.lang = browser.i18n.getUILanguage();
if (title) {
  title.textContent = t('extName');
}
if (copyButton) {
  copyButton.textContent = t('buttonCopyDiagnostics');
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
      void detect();
    } else {
      button.disabled = false;
      showAccessDenied(access, text.accessDenied);
    }
  });
}

/** Uma mensagem `resolveHls` por cartão HLS ainda sem `hls`; cada falha fica no próprio cartão. */
function resolvePlaylists(container: HTMLElement, candidates: VideoCandidate[]): void {
  const current = new Map(candidates.map((candidate) => [candidate.id, candidate]));
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
        if (response?.ok === true) {
          // SPEC-0015: a master resolvida passa a reivindicar variantes/arquivos; reagrupa (só move cartões).
          current.set(candidate.id, { ...candidate, hls: response.hls });
          applyGroups(container, groupCandidates([...current.values()]), text);
        }
      });
  }
}

async function detect(): Promise<void> {
  if (!content || !access) {
    return;
  }
  showMessage(content, t('popupSearching'), 'popup-loading');
  const tabId = await targetTabId();
  const response =
    tabId === undefined
      ? undefined
      : await browser.runtime.sendMessage<unknown, DetectResponse | undefined>({
          type: 'detect',
          tabId,
        });
  content.setAttribute('aria-busy', 'false');

  renderAccess(
    access,
    response?.ok === true ? response.access.blockedOrigins : [],
    text,
    (button) => {
      if (response?.ok === true) {
        grantAccess(response.access.blockedOrigins, button);
      }
    },
  );

  if (response?.ok === true) {
    if (response.candidates.length === 0 && response.access.blockedOrigins.length > 0) {
      content.replaceChildren();
    } else if (response.candidates.length === 0) {
      showMessage(content, t('popupEmpty'), 'empty-state');
    } else {
      const groups = groupCandidates(response.candidates);
      renderCandidates(
        content,
        groups,
        text,
        (candidate, button) => {
          void download(candidate, button);
        },
        hlsContext,
      );
      resolvePlaylists(content, hideRedundantCandidates(response.candidates));
    }
  } else if (response?.error === 'RESTRICTED_PAGE') {
    showMessage(content, t('popupRestricted'), 'restricted-state');
  } else {
    showMessage(content, t('popupDetectFailed'), 'detect-failed');
  }
}

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
    await navigator.clipboard.writeText(JSON.stringify(response.entries, null, 2));
    setStatus(footerStatus, t('statusDiagnosticsCopied'), false);
  } catch {
    setStatus(footerStatus, t('statusDiagnosticsFailed'), true);
  }
}

copyButton?.addEventListener('click', () => {
  void copyDiagnostics();
});
void detect();
