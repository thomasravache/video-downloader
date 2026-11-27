---
id: SPEC-0025
title: "Indicador da toolbar confiável: ícones no manifesto, estado padrão e contagem única"
tier: full
type: fix
user_facing: true
status: approved
created: 2026-11-26
parent: SPEC-0023
depends_on: [SPEC-0024]
consumes_contract: []
contract_version: 1
touches:
  - wxt.config.ts
  - public/icon/**
  - entrypoints/background/action-indicator.ts
  - entrypoints/background/index.ts
  - src/core/service.ts
  - tests/unit/**
  - tests/integration/**
  - e2e/**
adrs: [ADR-0001, ADR-0002, ADR-0009, ADR-0010]
external: []
size: S
approved_by: Thomas Ravache
approved_at: 2026-11-27
---

# SPEC-0025 — Indicador da toolbar confiável: ícones no manifesto, estado padrão e contagem única

## 1. Visão Geral
A SPEC-0022 entregou o indicador da toolbar: ícone colorido com badge quando a aba tem vídeo, cinza quando não tem. Na prática o ícone ClipDrop não aparece até a extensão chamar `setIcon` para a aba. O badge pode mostrar um número diferente do que o popup lista, e pode ficar com uma contagem antiga depois de uma navegação. Esta spec corrige o indicador para que o ícone e o número batam sempre com o popup.

## 2. Motivação & Escopo
**Motivação:** o dono relatou bugs "na parte do ícone" (2026-11-26). Achados confirmados na revisão e no build (`.output/chrome-mv3-{local,public}/manifest.json`):

| # | Defeito | Onde |
|---|---|---|
| I1 | O manifesto não declara `icons` nem `action.default_icon`. Os PNGs em `public/icon/icon-16.png` não seguem o padrão de nome que o WXT detecta, então `chrome://extensions` e a toolbar mostram o ícone genérico do Chrome | `wxt.config.ts` (`buildManifest`) |
| I2 | Nenhum estado padrão global: o ícone cinza só é aplicado por aba. Abas novas, páginas `chrome://` e abas abertas antes da instalação ficam com o ícone genérico. O Chrome também apaga o ícone e o badge da aba a cada navegação | `entrypoints/background/action-indicator.ts:39,74` |
| I3 | Duas fontes de contagem: ao abrir o popup, o badge recebe a lista combinada (DOM + rede); cada resposta de rede e cada troca de aba sobrescrevem com só a rede. Um vídeo achado só no DOM mostra "1" e depois some | `entrypoints/background/index.ts:139,179,249` |
| I4 | A cadeia assíncrona de `onResponseStarted` não é ordenada com a limpeza da navegação. Uma resposta da página anterior que termina depois pinta a contagem antiga na página nova | `entrypoints/background/index.ts:125-159` |
| I5 | O tooltip vem do `<title>ClipDrop</title>` do popup, não de `__MSG_extName__`: não é traduzido e não mostra " (local)" | `entrypoints/popup/index.html:6` → `action.default_title` |
| I6 | Erros das APIs de `action` são engolidos sem log, contra o §8 da SPEC-0022 | `entrypoints/background/action-indicator.ts:43-90` |
| I7 | Texto branco sobre o badge `#6366F1` dá cerca de 4,47:1, abaixo do 4,5:1 prometido no §5 da SPEC-0022 | `action-indicator.ts` (cor do badge) |
| I8 | Os testes UT-01 e UT-02 da SPEC-0022 não verificam qual conjunto de ícones é usado, e nenhum teste verifica o manifesto ou os PNGs | `tests/unit/action-indicator.test.ts` |

**Objetivos (dentro do escopo):**
- I1: `buildManifest` declara `icons` (conjunto ativo, 16/32/48/128) e `action.default_icon` (conjunto cinza) nos dois flavors, apontando para os PNGs que já existem em `public/icon/`.
- I2: no `runtime.onStartup`, no `runtime.onInstalled` e na carga do service worker, o estado global (sem `tabId`) fica cinza e sem badge. Depois de cada página carregada (`tabs.onUpdated` com `status: 'complete'`), o estado da aba é reaplicado.
- I3: uma fonte só: `service.cardCount(tabId)` = número de cartões que o popup mostraria, calculado com a mesma combinação e o mesmo agrupamento do popup (`mergeCandidates` → `hideRedundantCandidates` → `groupCandidates`), sobre a lista de rede e o último resultado de DOM da aba. Todo ponto que atualiza o badge usa essa contagem.
- I4: cada aba tem uma geração, incrementada quando a lista é apagada por navegação (a regra de troca de documento da SPEC-0024). Uma atualização que começou em uma geração anterior é descartada. Atualizações da mesma aba são serializadas.
- I5: `action.default_title` = `__MSG_extName__`, com " (local)" no build local, que já vem dos `_locales`.
- I6: toda falha de `setIcon`, `setBadgeText` ou `setBadgeBackgroundColor`, exceto "aba não existe", vira `action.update_failed` no diagnóstico, sem URL.
- I7: cor do badge `#4F46E5` com texto `#FFFFFF`, contraste de cerca de 6,3:1.
- I8: os testes verificam o caminho dos ícones, o manifesto gerado e a existência dos PNGs.

**Não-objetivos (fora do escopo):**
- Redesenhar os ícones ou alinhar ao mockup do Stitch: spec separada, por decisão do dono (2026-11-26). Isso inclui o contraste do ícone cinza na toolbar escura do Chrome (cerca de 3,3:1), que depende do desenho.
- Ícones diferentes por flavor: o tooltip com " (local)" já distingue os builds.
- SPA (troca de URL sem recarregar): o badge segue a lista de rede, que a SPEC-0024 mantém nesse caso.

## 3. Dependências
- **Implementações necessárias:** SPEC-0024 — a regra de troca de documento (`replacesDocument`), a revisão da lista e o agrupamento por `groupKey` são a base da geração (I4) e da contagem (I3)
- **Contratos consumidos:** N/A — a dependência é de implementação (mesmos arquivos do background)
- **Pré-requisitos externos:** N/A — `tabs.onUpdated` com `status` não exige a permissão `tabs`; os PNGs já existem

## 4. Decisão Arquitetural
**Contexto:** projeto existente. O indicador fica em `entrypoints/background/action-indicator.ts` atrás da porta `ActionPort` (SPEC-0022). A combinação e o agrupamento de candidatos ficam em `src/core/candidates.ts` e `src/core/service.ts`, e o popup os consome pela resposta do `detect`. Referências: `createActionIndicator` (contrato da SPEC-0022) e `buildManifest` em `wxt.config.ts` (que já monta permissões por flavor).

**Decisão:**
1. `ActionIndicator` ganha `setDefault()` (estado global) e passa a receber a geração: `updateForTab(tabId, count, generation)`. O próprio indicador descarta gerações antigas e serializa por aba.
2. `createDetectService` expõe `cardCount(tabId)`, que reaproveita a função de combinação usada pelo `detect` e guarda o último resultado de DOM por aba em memória. Se o service worker for reiniciado, a contagem cai para só a rede até o próximo `detect`.
3. Os ícones entram no manifesto por `buildManifest`, sem renomear arquivos, porque a SPEC-0022 e os testes citam os caminhos atuais.

**Justificativa:** mantém o indicador como adaptador fino (ADR-0001) e põe a regra de contagem no core, onde é testável. O popup e o badge passam a usar o mesmo cálculo, sem duplicar lógica.

**Desvio do padrão existente:** nenhum. O contrato `ActionIndicator` da SPEC-0022 muda (assinatura nova de `updateForTab` e `setDefault`). É interno ao background, e o CT-01 da SPEC-0022 é atualizado por esta spec.

**Alternativas descartadas:**
- *Renomear os PNGs para o padrão que o WXT detecta sozinho:* resolve o I1, mas não o ícone padrão cinza da toolbar (`default_icon`), e quebra caminhos já citados.
- *Badge com só a contagem da rede:* simples, mas diverge do popup sempre que o vídeo vem só do DOM (o I3).

**ADRs:** ADR-0001, ADR-0002, ADR-0009, ADR-0010

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** no máximo uma atualização de `action` em andamento por aba; atualizações antigas são descartadas sem chamar a API. Verificado em UT-04.
- **Segurança:** N/A — ícones locais, sem rede; nenhuma entrada externa nova.
- **Privacidade e dados pessoais:** o log `action.update_failed` tem só `tabId` e o nome do erro (UT-06).
- **Disponibilidade e resiliência:** API de `action` ausente ou parcial continua tolerada, como no UT-03 da SPEC-0022 (CH-01).
- **Acessibilidade (UI):** contraste do badge ≥ 4,5:1, calculado em UT-07; tooltip traduzido (UT-08).
- **Custo:** N/A — extensão local.

## 6. Artefato A — Contrato
**Interface:** `entrypoints/background/action-indicator.ts`, `service.cardCount` e manifesto gerado.

```ts
export interface ActionPort {            // igual à SPEC-0022
  setIcon(details: { tabId?: number; path: Record<number, string> }): Promise<void> | void;
  setBadgeText(details: { tabId?: number; text: string }): Promise<void> | void;
  setBadgeBackgroundColor(details: { tabId?: number; color: string }): Promise<void> | void;
  setBadgeTextColor?(details: { tabId?: number; color: string }): Promise<void> | void;
}

export interface ActionIndicator {
  /** Estado global (sem tabId): IDLE_ICONS, badge vazio. */
  setDefault(): Promise<void>;
  /** Aplica o estado da aba se `generation` for a atual dela; serializado por aba. count > 0 → ativo. */
  updateForTab(tabId: number, count: number, generation: number): Promise<void>;
  /** Incrementa a geração da aba e aplica o estado cinza. Devolve a nova geração. */
  resetForTab(tabId: number): Promise<number>;
  /** Geração atual da aba (0 se nunca reiniciada). */
  generationOf(tabId: number): number;
}
export function createActionIndicator(action?: ActionPort, diagnostics?: Pick<Diagnostics, 'log'>): ActionIndicator;
export const BADGE_COLOR = '#4F46E5';
export const BADGE_TEXT_COLOR = '#FFFFFF';

// src/core/service.ts
/** Número de cartões que o popup mostraria para a aba: rede + último DOM, combinados e agrupados como no detect. */
cardCount(tabId: number): Promise<number>;
```

**Manifesto gerado (os dois flavors):**
```json
{
  "icons": { "16": "icon/icon-16.png", "32": "icon/icon-32.png", "48": "icon/icon-48.png", "128": "icon/icon-128.png" },
  "action": {
    "default_title": "__MSG_extName__",
    "default_popup": "popup.html",
    "default_icon": { "16": "icon/icon-idle-16.png", "32": "icon/icon-idle-32.png", "48": "icon/icon-idle-48.png", "128": "icon/icon-idle-128.png" }
  }
}
```

**Ligação no background:** carga do worker, `onStartup` e `onInstalled` → `setDefault()`. Navegação que troca o documento (SPEC-0024) → `resetForTab`. Candidato novo na rede, `detect`, troca de aba e `tabs.onUpdated` com `status: 'complete'` → `updateForTab(tabId, await service.cardCount(tabId), geração lida antes do await)`. `tabs.onRemoved` → descarta o estado da aba.

**Design:** N/A — usa os ícones e as cores atuais (só a cor do badge escurece).

**Arquivos/módulos afetados:** ver `touches`.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Ícone no manifesto | `pnpm build` nos dois flavors | `icons` e `action.default_icon` declarados; todo PNG citado existe na saída | UT-01, IT-01 |
| Estado padrão global | worker carregado, `onStartup` ou `onInstalled` | `setIcon` sem `tabId` com `IDLE_ICONS`; badge global vazio | UT-02, IT-02 |
| Aba com vídeos | `cardCount = 2` | `ACTIVE_ICONS`, badge "2", cor `#4F46E5` | UT-03 |
| Aba sem vídeos | `cardCount = 0` | `IDLE_ICONS`, badge vazio | UT-03 |
| Reaplicar após carregar | `tabs.onUpdated` com `status: 'complete'` em uma aba com 1 cartão | ícone ativo e badge "1" reaplicados | IT-02 |
| Contagem única | vídeo só no DOM (rede vazia), seguido de troca de aba e volta | o badge mostra "1" o tempo todo | UT-05, IT-03 |
| Fontes redundantes | 3 candidatos de rede que o popup agrupa em 1 cartão | badge "1" | UT-05 |
| Resposta atrasada da página anterior | geração 1 → navegação (geração 2) → chega a atualização da geração 1 | descartada; o badge continua vazio | UT-04, IT-04 |
| Tooltip | build `local` e build `public` | `default_title = __MSG_extName__`; o locale local termina em " (local)" | UT-08, IT-01 |
| Falha da API | `setIcon` lança "erro genérico" | log `action.update_failed` com `tabId` e o nome do erro, sem URL | UT-06 |
| Aba fechada | `setIcon` lança "No tab with id" | sem log, sem exceção | UT-06, CH-01 |
| Contraste do badge | `BADGE_COLOR` vs `BADGE_TEXT_COLOR` | razão ≥ 4,5:1 | UT-07 |
| Popup e badge batem | página de fixture com 1 vídeo direto | o badge mostra o mesmo número de cartões do popup | E2E-01 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
- **CH-01** — Dado o indicador atual sem `ActionPort`, ou com métodos que lançam "No tab with id", quando atualizado, então não lança exceção (fixa o UT-03 da SPEC-0022). (guarda: passa antes da mudança)

### 7.2 Testes Unitários
- **UT-01** — Dado `buildManifest('local')` e `buildManifest('public')`, então ambos têm `icons` com os caminhos ativos 16/32/48/128 e `action.default_icon` com os caminhos cinza, e cada caminho existe em `public/`.
- **UT-02** — Dado o indicador, quando `setDefault()` roda, então chama `setIcon({ path: IDLE_ICONS })` e `setBadgeText({ text: '' })` sem `tabId`.
- **UT-03** — Dados `updateForTab(7, 2, 0)` e `updateForTab(7, 0, 0)`, então o primeiro usa exatamente `ACTIVE_ICONS`, o badge "2" e `#4F46E5`, e o segundo usa exatamente `IDLE_ICONS` e o badge vazio.
- **UT-04** — Dado `resetForTab(7)`, que leva a geração a 1, quando chega `updateForTab(7, 3, 0)`, então nenhuma API é chamada; e duas atualizações simultâneas da mesma aba rodam em sequência, ficando a última.
- **UT-05** — Dado `service.cardCount` com 1 candidato só do DOM e a rede vazia, então devolve 1; com 3 candidatos de rede que `groupCandidates` reúne em 1 cartão, devolve 1; com dois masters de `groupKey` diferentes, devolve 2.
- **UT-06** — Dado `setIcon` que lança `Error('boom')`, então o diagnóstico recebe `action.update_failed` com `{ tabId, reason: 'Error' }` e nenhuma URL; e com "No tab with id: 7", nada é registrado.
- **UT-07** — Dadas `BADGE_COLOR` e `BADGE_TEXT_COLOR`, quando se calcula a razão de contraste WCAG, então ela é ≥ 4,5.
- **UT-08** — Dado `buildManifest(flavor)`, então `action.default_title` é `__MSG_extName__` nos dois flavors.

### 7.3 Testes de Integração
- **IT-01** — `pnpm build` (fixture `build-artifacts`): os dois manifestos de `.output/` têm `icons`, `action.default_icon` e `default_title = __MSG_extName__`; todo PNG citado existe; `_locales/*/messages.json` do local termina em " (local)".
- **IT-02** — Background com `fakeBrowser`: na carga, `setDefault` é chamado; `tabs.onUpdated` com `status: 'complete'` para uma aba com candidatos reaplica o ícone ativo e o badge.
- **IT-03** — `detect` com 1 vídeo só do DOM põe o badge em "1"; um `tabs.onActivated` para outra aba e a volta mantêm "1".
- **IT-04** — Uma resposta de rede da página anterior que termina depois da navegação (o `tabs.get` resolve depois da limpeza) não altera o badge da página nova.

### 7.4 Testes de Contrato
- **CT-01** — `createActionIndicator` cumpre o contrato da seção 6 (`setDefault`, `updateForTab` com geração, `resetForTab`, `generationOf`) com um `ActionPort` no formato do Chrome; atualiza `tests/unit/action-contract.test.ts` da SPEC-0022.

### 7.5 Testes E2E
- **E2E-01** — [jornada: baixar-video-direto] Com a extensão carregada, o usuário abre a página de fixture com um `<video src>` direto e abre o popup, que lista 1 cartão. O texto do badge da aba (lido por `chrome.action.getBadgeText` no service worker) é "1"; depois de navegar para uma página sem vídeo, é "". Atualiza `e2e/journeys/clipdrop-branding.spec.ts`.

### 7.6 Outros
- N/A — o contraste é coberto por UT-07.

**Dublês e dados de teste:** `ActionPort` gravador (registra cada chamada); `fakeBrowser` do WXT; diagnóstico falso que acumula entradas; fixtures `e2e/fixtures/pages` existentes.

**Ambiente de execução:** Vitest local e no CI; IT-01 roda o build real; E2E com Playwright e a extensão carregada nos dois flavors.

## 8. Plano de Rollout
- **Estratégia:** deploy direto, na mesma release candidate da SPEC-0024 (`0.1.0-rc.10`), pelo pipeline.
- **Dados/schema:** N/A — estado só em memória do service worker.
- **Compatibilidade:** manifesto MV3 com `minimum_chrome_version: 116`; `icons` e `default_icon` são suportados.
- **Observabilidade:** log novo `action.update_failed`, no "Copiar diagnóstico".
- **Rollback:** reverter o merge e publicar a `0.1.0-rc.9`; o dono decide.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
- [x] Alinhar o ícone e o popup ao mockup do Stitch entra aqui? — Não: só os bugs do ícone agora; o alinhamento vira spec separada (Thomas Ravache, 2026-11-26)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
**Fase 0: Caracterização**
- [ ] CH-01 escrito com a tag `SPEC-0025:CH-01`, passando no código atual, commitado antes de qualquer mudança

**Fase 1: Manifesto e estado padrão (I1, I2, I5)**
- [ ] Red: UT-01, UT-02, UT-08, IT-01, IT-02 falhando pelo motivo certo
- [ ] Green: `icons`, `action.default_icon` e `default_title` em `buildManifest`; `setDefault()` na carga do worker, em `onStartup` e em `onInstalled`; reaplicação em `tabs.onUpdated` com `status: 'complete'`

**Fase 2: Contagem e geração (I3, I4)**
- [ ] Red: UT-03, UT-04, UT-05, IT-03, IT-04, CT-01 falhando pelo motivo certo
- [ ] Green: `service.cardCount`, geração por aba e serialização no indicador; todos os pontos de atualização usam `cardCount`

**Fase 3: Diagnóstico e contraste (I6, I7)**
- [ ] Red: UT-06, UT-07 falhando pelo motivo certo
- [ ] Green: log `action.update_failed`; `BADGE_COLOR = #4F46E5`
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 4: Jornada E2E**
- [ ] Red: E2E-01 (badge igual ao popup) falhando pelo motivo certo
- [ ] Green: E2E-01 passando localmente nos dois flavors

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy via pipeline com smoke/E2E no ambiente (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 0f94085 | 2026-11-26 |
| G1 Red | PENDING | | |
| G2 Green | PENDING | | |
| G3 Arquitetura | PENDING | | |
| G4 Review | PENDING | | |
| G5 Integração & CI | PENDING | | |
| H2 Integração aprovada | PENDING | | |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 14. Relatório de Entrega

### O que foi entregue

### Como foi feito

### Prova de Correção

### Verificação
| Teste | Comportamento | Resultado | Evidência |
|---|---|---|---|

### Definição de Pronto
- [ ] Todos os testes do plano passando e listados na Verificação
- [ ] Todo comportamento do Mapa de Comportamentos coberto e verificado
- [ ] Suíte completa, arquitetura e CI verdes no resultado integrado (G5)
- [ ] Review independente sem achados blocker/major (G4)
- [ ] Padrão arquitetural existente mantido, ou desvio coberto por ADR aprovado
- [ ] Requisitos não-funcionais medidos com evidência (ou N/A justificado)
- [ ] Disponível no ambiente-alvo via pipeline, com smoke/E2E passando no ambiente (G6)
- [ ] Observabilidade e rollback prontos conforme o Plano de Rollout
- [ ] Documentação raiz e CHANGELOG atualizados (G7)
- [ ] Guia de jornadas e mapa do sistema atualizados quando a entrega muda uma jornada ou um componente (G7)
- [ ] Pendências registradas como novas specs (ou nenhuma)

### Deploy

### Pendências

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
