/** Contexto de requisição da página (SPEC-0016): derivação do contexto e regra DNR de sessão. */
import { isHttpOrigin } from './contracts';
import type { VideoCandidate } from './contracts';
import type { RequestContextLease, RequestContextPort } from './ports';

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

/** Menor id das regras de sessão deste uso (faixa reservada 7_000_000+). */
export const RESERVED_RULE_ID = 7_000_000;
/** Teto de hosts por regra. */
export const MAX_RULE_HOSTS = 8;

/** Nome DNS ou IPv4 (sem esquema, caminho, query, porta, espaço ou curinga). */
const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** `new URL(initiator).origin` se o esquema é http(s); senão `undefined` (extensão, `null`, lixo, ausente). */
export function initiatorOriginOf(initiator: string | undefined): string | undefined {
  if (initiator === undefined) {
    return undefined;
  }
  try {
    const { protocol, origin } = new URL(initiator);
    return protocol === 'http:' || protocol === 'https:' ? origin : undefined;
  } catch {
    return undefined;
  }
}

/** `{origin, referer: origin + '/'}` do candidato; `undefined` sem `initiatorOrigin`. */
export function contextFor(
  candidate: Pick<VideoCandidate, 'initiatorOrigin'>,
): RequestContext | undefined {
  const { initiatorOrigin } = candidate;
  return initiatorOrigin !== undefined && isHttpOrigin(initiatorOrigin)
    ? { origin: initiatorOrigin, referer: `${initiatorOrigin}/` }
    : undefined;
}

/** Regra de sessão do contrato (§6) ou recusa (host inválido/vazio, > 8 hosts, origem inválida ou da extensão). */
export function buildContextRule(options: BuildContextRuleOptions): ContextRuleResult {
  const { id, origin, extensionId } = options;
  if (!isHttpOrigin(origin)) {
    return { ok: false, error: 'origem inválida' };
  }
  const hosts = [...new Set(options.hosts.map((host) => host.toLowerCase()))];
  if (hosts.length === 0 || hosts.length > MAX_RULE_HOSTS) {
    return { ok: false, error: 'quantidade de hosts inválida' };
  }
  if (!hosts.every((host) => HOST_NAME.test(host))) {
    return { ok: false, error: 'host inválido' };
  }
  return {
    ok: true,
    rule: {
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'origin', operation: 'set', value: origin },
          { header: 'referer', operation: 'set', value: `${origin}/` },
        ],
      },
      condition: {
        requestDomains: hosts,
        initiatorDomains: [extensionId],
        resourceTypes: ['xmlhttprequest'],
      },
    },
  };
}

/** Nome de host de uma URL http(s), ou `undefined`. */
export function hostOf(url: string): string | undefined {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? hostname : undefined;
  } catch {
    return undefined;
  }
}

/** Status HTTP de uma falha de busca (`error.status` inteiro), se houver. */
export function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined;
}

export interface ContextScopeOptions {
  /** Busca simples (sem contexto); rejeita com `error.status` quando o servidor responde com erro HTTP. */
  fetch: (url: string) => Promise<string>;
  /** Ausente (flavor public): nunca repete. */
  requestContext?: RequestContextPort | undefined;
  candidate: Pick<VideoCandidate, 'initiatorOrigin'>;
  /** Observabilidade: o contexto foi instalado (`used: true`) ou a instalação falhou (`used: false`). */
  onContext?: (event: { used: boolean; status: number }) => void;
}

/**
 * Escada de busca de uma operação (SPEC-0016): busca simples; só em 401/403, com `initiatorOrigin` e a porta de
 * contexto, instala UMA regra (hosts da URL recusada), repete UMA vez e mantém a regra até `release()` — as
 * buscas seguintes da operação já saem com o contexto. Qualquer outro resultado é o erro normal da busca.
 */
export interface ContextScope {
  fetch(url: string): Promise<string>;
  /** O contexto foi necessário e está instalado (a regra está em posse do escopo). */
  readonly used: boolean;
  /** Origem do contexto instalado (para a regra do job). */
  readonly origin: string | undefined;
  /** Remove a regra do escopo; idempotente. */
  release(): Promise<void>;
}

export function createContextScope(options: ContextScopeOptions): ContextScope {
  const context = contextFor(options.candidate);
  /** A regra da operação; buscas paralelas que recebem 401/403 compartilham a mesma instalação. */
  let held: Promise<RequestContextLease> | undefined;
  let installed = false;
  async function install(host: string, origin: string, status: number): Promise<boolean> {
    const port = options.requestContext;
    if (port === undefined) {
      return false;
    }
    held ??= port.acquire({ hosts: [host], origin });
    try {
      await held;
    } catch {
      held = undefined;
      options.onContext?.({ used: false, status });
      return false;
    }
    if (!installed) {
      installed = true;
      options.onContext?.({ used: true, status });
    }
    return true;
  }
  return {
    async fetch(url) {
      // Já saiu com o contexto da operação: a recusa é definitiva (no máximo 1 repetição por recurso).
      const hadContext = installed;
      try {
        return await options.fetch(url);
      } catch (error) {
        const status = statusOf(error);
        const host = hostOf(url);
        if (
          hadContext ||
          (status !== 401 && status !== 403) ||
          context === undefined ||
          host === undefined ||
          !(await install(host, context.origin, status))
        ) {
          throw error;
        }
        return options.fetch(url);
      }
    },
    get used() {
      return installed;
    },
    get origin() {
      return context?.origin;
    },
    async release() {
      const lease = held;
      held = undefined;
      installed = false;
      await (await lease?.catch(() => undefined))?.release();
    },
  };
}
