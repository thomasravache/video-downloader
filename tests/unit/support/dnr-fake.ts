/**
 * Fake em memória de `declarativeNetRequest` (regras de sessão) para os testes da SPEC-0016. Não é teste.
 * Imita o Chrome: id duplicado em `addRules` rejeita a chamada inteira; `removeRuleIds` de id inexistente
 * é ignorado. Guarda o histórico de chamadas e de todas as regras já adicionadas.
 */
import type { DnrPort } from '../../../entrypoints/background/request-context';
import type { ContextRule } from '../../../src/core/request-context';

export interface SessionRule {
  id: number;
  priority?: number;
  action?: unknown;
  condition?: { requestDomains?: string[]; initiatorDomains?: string[]; resourceTypes?: string[] };
}

export interface DnrFake extends DnrPort {
  /** Regras ativas agora. */
  rules(): SessionRule[];
  /** Ids ativos agora. */
  ids(): number[];
  /** Cada chamada de `updateSessionRules`, em ordem. */
  calls: { addRules: SessionRule[]; removeRuleIds: number[] }[];
  /** Toda regra já adicionada (mesmo as removidas depois), em ordem. */
  everAdded(): SessionRule[];
  /** Maior número de regras ativas ao mesmo tempo. */
  peak(): number;
  /** Planta regras (ex.: órfãs de um service worker anterior) sem passar pelo histórico. */
  seed(rules: SessionRule[]): void;
}

export function createDnrFake(): DnrFake {
  const active = new Map<number, SessionRule>();
  const calls: DnrFake['calls'] = [];
  const added: SessionRule[] = [];
  let peak = 0;
  return {
    calls,
    rules: () => [...active.values()],
    ids: () => [...active.keys()],
    everAdded: () => [...added],
    peak: () => peak,
    seed(rules) {
      for (const rule of rules) {
        active.set(rule.id, rule);
      }
    },
    updateSessionRules(options) {
      const addRules = options.addRules ?? [];
      const removeRuleIds = options.removeRuleIds ?? [];
      calls.push({ addRules, removeRuleIds });
      for (const id of removeRuleIds) {
        active.delete(id);
      }
      const seen = new Set<number>();
      for (const rule of addRules) {
        if (active.has(rule.id) || seen.has(rule.id)) {
          return Promise.reject(
            new Error(`Rule with id ${String(rule.id)} does not have a unique ID.`),
          );
        }
        seen.add(rule.id);
      }
      for (const rule of addRules) {
        active.set(rule.id, rule);
        added.push(rule);
      }
      peak = Math.max(peak, active.size);
      return Promise.resolve();
    },
    getSessionRules: () => Promise.resolve([...active.values()]),
  };
}

export type { ContextRule };
