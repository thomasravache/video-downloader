import type { RequestContextLease, RequestContextPort } from '../../src/core/ports';
import { RESERVED_RULE_ID, buildContextRule } from '../../src/core/request-context';
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

/** Regras simultâneas da extensão (SPEC-0016 §5). */
const MAX_RULES = 4;

/** Gerenciador de regras de sessão (SPEC-0016): uma regra por operação, ids únicos, no máximo 4 ativas. */
export function createRequestContextManager(
  deps: RequestContextManagerDeps,
): RequestContextManager {
  const { dnr, extensionId } = deps;
  /** Ids das regras que este gerenciador instalou (ou está instalando) e ainda não liberou. */
  const held = new Set<number>();

  async function acquire(opts: { hosts: string[]; origin: string }): Promise<RequestContextLease> {
    const existing = new Set((await dnr.getSessionRules()).map((rule) => rule.id));
    // Daqui até `held.add` não há `await`: acquires paralelos nunca escolhem o mesmo id.
    if (held.size >= MAX_RULES) {
      throw new Error('limite de regras de contexto atingido');
    }
    let id = RESERVED_RULE_ID;
    while (existing.has(id) || held.has(id)) {
      id += 1;
    }
    const built = buildContextRule({ id, ...opts, extensionId });
    if (!built.ok) {
      throw new Error(`regra de contexto recusada: ${built.error}`);
    }
    held.add(id);
    try {
      await dnr.updateSessionRules({ addRules: [built.rule] });
    } catch (error) {
      held.delete(id);
      throw error;
    }
    let released: Promise<void> | undefined;
    return {
      release() {
        released ??= dnr.updateSessionRules({ removeRuleIds: [id] }).finally(() => held.delete(id));
        return released;
      },
    };
  }

  async function removeOrphans(): Promise<void> {
    const orphans = (await dnr.getSessionRules())
      .map((rule) => rule.id)
      .filter((id) => id >= RESERVED_RULE_ID && !held.has(id));
    if (orphans.length > 0) {
      await dnr.updateSessionRules({ removeRuleIds: orphans });
    }
  }

  return { acquire, removeOrphans };
}
