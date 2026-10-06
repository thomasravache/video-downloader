/**
 * Fake de `browser.declarativeNetRequest` para os testes de integração da SPEC-0016. Não é teste.
 *
 * O fake do WXT não tem `declarativeNetRequest`. Aqui `updateSessionRules`/`getSessionRules` guardam as regras
 * de sessão (fake em memória de tests/unit/support/dnr-fake.ts) e o `fetch` GLOBAL do Node passa a aplicar, a
 * cada requisição, as regras `modifyHeaders`/`set` cuja `condition.requestDomains` casa com o host da URL
 * (host igual ou subdomínio), `resourceTypes` inclui `xmlhttprequest` e `initiatorDomains` inclui o id da
 * extensão (todo `fetch` da harness é da extensão: service worker e offscreen). Assim os testes provam o
 * PROTOCOLO: regra instalada com hosts/cabeçalhos exatos ANTES da repetição e removida depois. (Se o Chromium
 * real sobrescreve `Origin` é a prova do E2E-01, não deste fake.)
 *
 * Chamar ANTES de `background.main()` e de `simulateOffscreen` (que lê `globalThis.fetch` ao ser criado);
 * `vi.restoreAllMocks()` desfaz o `fetch` interceptado.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { vi } from 'vitest';
import { createDnrFake } from '../../unit/support/dnr-fake';
import type { DnrFake } from '../../unit/support/dnr-fake';

export interface AppliedRule {
  url: string;
  ruleIds: number[];
}

export interface DnrHarness extends DnrFake {
  /** Para cada `fetch` feito, os ids das regras cujos cabeçalhos foram aplicados (vazio = nenhum contexto). */
  applied: AppliedRule[];
}

interface RuleShape {
  id: number;
  action?: {
    type?: string;
    requestHeaders?: { header: string; operation: string; value?: string }[];
  };
  condition?: { requestDomains?: string[]; initiatorDomains?: string[]; resourceTypes?: string[] };
}

const hostMatches = (host: string, domains: string[]): boolean =>
  domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

export function installDnr(): DnrHarness {
  const fake = createDnrFake();
  const applied: AppliedRule[] = [];
  Object.defineProperty(fakeBrowser, 'declarativeNetRequest', {
    configurable: true,
    value: {
      updateSessionRules: fake.updateSessionRules.bind(fake),
      getSessionRules: fake.getSessionRules.bind(fake),
    },
  });

  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).hostname;
    const headers = new Headers(init?.headers);
    const ruleIds: number[] = [];
    for (const rule of fake.rules() as RuleShape[]) {
      const { condition, action } = rule;
      if (
        action?.type !== 'modifyHeaders' ||
        !hostMatches(host, condition?.requestDomains ?? []) ||
        !(condition?.resourceTypes ?? []).includes('xmlhttprequest') ||
        !(condition?.initiatorDomains ?? []).includes(fakeBrowser.runtime.id)
      ) {
        continue;
      }
      for (const change of action.requestHeaders ?? []) {
        if (change.operation === 'set' && change.value !== undefined) {
          headers.set(change.header, change.value);
        }
      }
      ruleIds.push(rule.id);
    }
    applied.push({ url, ruleIds });
    return realFetch(input, { ...init, headers });
  });

  return Object.assign(fake, { applied });
}
