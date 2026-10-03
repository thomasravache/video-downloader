import type { RequestContextPort } from '../../src/core/ports';
import type { ContextRule } from '../../src/core/request-context';

/** Recorte de `browser.declarativeNetRequest` usado pelo gerenciador (SPEC-0016). */
export interface DnrPort {
  updateSessionRules(options: {
    addRules?: ContextRule[];
    removeRuleIds?: number[];
  }): Promise<void>;
  getSessionRules(): Promise<{ id: number }[]>;
}

export interface RequestContextManagerDeps {
  dnr: DnrPort;
  extensionId: string;
}

export interface RequestContextManager extends RequestContextPort {
  /** Partida do service worker: remove as regras da faixa reservada (7_000_000+) que sobraram. */
  removeOrphans(): Promise<void>;
}

/** Gerenciador de regras de sessão (SPEC-0016): uma regra por operação, ids únicos, no máximo 4 ativas. */
export function createRequestContextManager(
  _deps: RequestContextManagerDeps,
): RequestContextManager {
  return {
    acquire: () => Promise.reject(new Error('NotImplemented: acquire (SPEC-0016)')),
    removeOrphans: () => Promise.reject(new Error('NotImplemented: removeOrphans (SPEC-0016)')),
  };
}
