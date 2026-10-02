import type {
  DetectResponse,
  DiagnosticsResponse,
  DownloadResponse,
  VideoCandidate,
} from '../../src/core/contracts';
import { renderCandidates, setStatus, showMessage } from './view';
import type { ViewText } from './view';

const t = (key: string, ...substitutions: string[]): string =>
  browser.i18n.getMessage(key as never, substitutions);

const text: ViewText = {
  listLabel: t('listLabel'),
  badgeDrm: t('badgeDrm'),
  badgeUnsupported: t('badgeUnsupported'),
  download: t('buttonDownload'),
  downloadNamed: (title) => t('buttonDownloadNamed', title),
};

const title = document.getElementById('title');
const content = document.getElementById('content');
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

async function detect(): Promise<void> {
  if (!content) {
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

  if (response?.ok === true) {
    if (response.candidates.length === 0) {
      showMessage(content, t('popupEmpty'), 'empty-state');
    } else {
      renderCandidates(content, response.candidates, text, (candidate, button) => {
        void download(candidate, button);
      });
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
