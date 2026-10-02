import type {
  DetectResponse,
  DiagnosticsResponse,
  DownloadResponse,
  ResolveHlsResponse,
  VideoCandidate,
} from '../../src/core/contracts';
import { requestAccess } from '../../src/core/access';
import type { PermissionsPort } from '../../src/core/access';
import {
  renderAccess,
  renderCandidates,
  renderHlsResult,
  setStatus,
  showAccessDenied,
  showMessage,
} from './view';
import type { ViewText } from './view';

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
  hlsLoading: t('hlsLoading'),
  hlsQuality: t('hlsQuality'),
  hlsErrorFetch: t('hlsErrorFetch'),
  hlsErrorParse: t('hlsErrorParse'),
  hlsErrorGeneric: t('hlsErrorGeneric'),
  duration: (formatted) => t('hlsDuration', formatted),
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
    case 'INVALID_MESSAGE':
    default:
      return t('errorGeneric');
  }
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
        renderHlsResult(container, candidate.id, response, text);
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
      renderCandidates(content, response.candidates, text, (candidate, button) => {
        void download(candidate, button);
      });
      resolvePlaylists(content, response.candidates);
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
