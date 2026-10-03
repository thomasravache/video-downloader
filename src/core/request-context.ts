/** Contexto de requisição da página (SPEC-0016): derivação do contexto e regra DNR de sessão. */
import type { VideoCandidate } from './contracts';

/** `Origin` e `Referer` que o navegador do usuário já enviou para o frame iniciador. */
export interface RequestContext {
  origin: string;
  referer: string;
}

export interface ContextRule {
  id: number;
  priority: 1;
  action: {
    type: 'modifyHeaders';
    requestHeaders: { header: 'origin' | 'referer'; operation: 'set'; value: string }[];
  };
  condition: {
    requestDomains: string[];
    initiatorDomains: string[];
    resourceTypes: ['xmlhttprequest'];
  };
}

export interface BuildContextRuleOptions {
  id: number;
  hosts: readonly string[];
  origin: string;
  extensionId: string;
}

export type ContextRuleResult = { ok: true; rule: ContextRule } | { ok: false; error: string };

/** `{origin, referer: origin + '/'}` do candidato; `undefined` sem `initiatorOrigin`. */
export function contextFor(
  _candidate: Pick<VideoCandidate, 'initiatorOrigin'>,
): RequestContext | undefined {
  throw new Error('NotImplemented: contextFor (SPEC-0016)');
}

/** Regra de sessão do contrato (§6) ou recusa (host inválido/vazio, > 8 hosts, origem inválida ou da extensão). */
export function buildContextRule(_options: BuildContextRuleOptions): ContextRuleResult {
  throw new Error('NotImplemented: buildContextRule (SPEC-0016)');
}
