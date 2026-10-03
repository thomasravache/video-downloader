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
      const { urls, initUrl, fmp4, ranges, initRange } = record;
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
        (initRange === undefined || (initUrl !== undefined && isByteRange(initRange)))
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
