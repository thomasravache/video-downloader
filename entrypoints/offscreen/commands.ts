import type { OffscreenCommand, OffscreenStart } from '../../src/core/hls-download';

const isHttpUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/** Faixa válida: inteiros seguros, `offset >= 0`, `length >= 1`, `offset + length` seguro. */
function isByteRange(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { offset, length } = value as Record<string, unknown>;
  return (
    typeof offset === 'number' &&
    typeof length === 'number' &&
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 1 &&
    offset + length <= Number.MAX_SAFE_INTEGER
  );
}

function isEncryptionKey(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { url, iv } = value as Record<string, unknown>;
  if (!isHttpUrl(url)) {
    return false;
  }
  if (iv !== undefined) {
    if (typeof iv !== 'string' || !/^[0-9a-f]{32}$/.test(iv)) {
      return false;
    }
  }
  return true;
}

function isEncryptionPlan(value: unknown, urlCount: number): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { keys, segmentKeys, initKey, mediaSequence } = value as Record<string, unknown>;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 8 || !keys.every(isEncryptionKey)) {
    return false;
  }
  if (
    !Array.isArray(segmentKeys) ||
    segmentKeys.length !== urlCount ||
    !segmentKeys.every(
      (k) =>
        k === null || (typeof k === 'number' && Number.isInteger(k) && k >= 0 && k < keys.length),
    )
  ) {
    return false;
  }
  if (typeof mediaSequence !== 'number' || !Number.isInteger(mediaSequence) || mediaSequence < 0) {
    return false;
  }
  if (
    initKey !== undefined &&
    initKey !== null &&
    (typeof initKey !== 'number' ||
      !Number.isInteger(initKey) ||
      initKey < 0 ||
      initKey >= keys.length)
  ) {
    return false;
  }
  return true;
}

/** Faixa de áudio do `start` (SPEC-0014): mesmas regras de `urls`/`ranges`/`initUrl`/`initRange` do vídeo. */
function isAudioTrack(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { urls, initUrl, ranges, initRange, encryption } = value as Record<string, unknown>;
  return (
    Array.isArray(urls) &&
    urls.length > 0 &&
    urls.every(isHttpUrl) &&
    (initUrl === undefined || isHttpUrl(initUrl)) &&
    (ranges === undefined ||
      (Array.isArray(ranges) &&
        ranges.length === urls.length &&
        ranges.every((item) => item === undefined || item === null || isByteRange(item)))) &&
    (initRange === undefined || (initUrl !== undefined && isByteRange(initRange))) &&
    (encryption === undefined || isEncryptionPlan(encryption, urls.length))
  );
}

/** Valida a forma completa do comando (nunca confia só em `type`). */
export function isCommand(message: unknown): message is OffscreenCommand {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const record = message as Record<string, unknown>;
  if (record['target'] !== 'offscreen' || typeof record['jobId'] !== 'string') {
    return false;
  }
  switch (record['type']) {
    case 'cancel':
      return true;
    case 'revoke':
      return typeof record['blobUrl'] === 'string';
    case 'start': {
      const { urls, initUrl, fmp4, ranges, initRange, audio, encryption } = record;
      return (
        Array.isArray(urls) &&
        urls.length > 0 &&
        urls.every(isHttpUrl) &&
        (initUrl === undefined || isHttpUrl(initUrl)) &&
        typeof fmp4 === 'boolean' &&
        // `sendMessage` serializa `undefined` em array como `null`: ambos significam "sem faixa".
        (ranges === undefined ||
          (Array.isArray(ranges) &&
            ranges.length === urls.length &&
            ranges.every((item) => item === undefined || item === null || isByteRange(item)))) &&
        (initRange === undefined || (initUrl !== undefined && isByteRange(initRange))) &&
        (!('audio' in record) || audio === undefined || isAudioTrack(audio)) &&
        (encryption === undefined || isEncryptionPlan(encryption, urls.length))
      );
    }
    default:
      return false;
  }
}

export interface CommandDeps {
  run(start: OffscreenStart, signal: AbortSignal): Promise<void>;
  revoke(blobUrl: string): void;
}

/** Executa comandos já validados; `start` de um jobId em andamento é ignorado. */
export function createCommandHandler(deps: CommandDeps): (command: OffscreenCommand) => void {
  const controllers = new Map<string, AbortController>();
  return (command) => {
    switch (command.type) {
      case 'start': {
        if (controllers.has(command.jobId)) {
          return;
        }
        const controller = new AbortController();
        controllers.set(command.jobId, controller);
        void deps.run(command, controller.signal).finally(() => {
          controllers.delete(command.jobId);
        });
        break;
      }
      case 'cancel':
        controllers.get(command.jobId)?.abort();
        break;
      case 'revoke':
        deps.revoke(command.blobUrl);
        break;
    }
  };
}
