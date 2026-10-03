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
      const { urls, initUrl, fmp4 } = record;
      return (
        Array.isArray(urls) &&
        urls.length > 0 &&
        urls.every(isHttpUrl) &&
        (initUrl === undefined || isHttpUrl(initUrl)) &&
        typeof fmp4 === 'boolean'
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
