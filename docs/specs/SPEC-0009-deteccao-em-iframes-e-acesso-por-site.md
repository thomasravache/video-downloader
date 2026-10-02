---
id: SPEC-0009
title: Detecção em iframes e acesso por site
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-02
parent: SPEC-0008
depends_on: [SPEC-0005]
consumes_contract: []
contract_version: 1
touches: [wxt.config.ts, .dependency-cruiser.cjs, src/core/**, src/providers/generic/**, entrypoints/**, public/_locales/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**]
adrs: [ADR-0012, ADR-0007, ADR-0011, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-02
---

# SPEC-0009 — Detecção em iframes e acesso por site

<!-- type: feature | fix | refactor | migration | foundation. user_facing: true quando a mudança altera uma jornada do usuário (UI ou API pública) — exige teste E2E. Substitua todos os marcadores com chaves duplas: o G0 (`spec_graph.py validate`) reprova a spec enquanto restar algum. As seções de Checklist em diante são preenchidas depois da aprovação, sem marcadores. -->

## 1. Visão Geral
A extensão passa a olhar **todos os frames** da aba, não só o documento principal. Vídeos dentro de iframes (inclusive de outro domínio, como em plataformas de curso) aparecem na lista. No build `local` o acesso é amplo (`host_permissions`); no build `public` a extensão descobre quais origens de iframe estão **bloqueadas** e o popup pede ao usuário, com um clique, o acesso a essas origens (`optional_host_permissions`), repetindo a detecção em seguida (ADR-0012).

## 2. Motivação & Escopo
**Motivação:** na verificação manual da fundação, a página da MDN (vídeo dentro de iframe de outro domínio) mostrou "Nenhum vídeo encontrado", porque a detecção olhava só o frame principal (`executeScript` com `target: { tabId }`). Detecção é o núcleo do produto.

**Objetivos (dentro do escopo):**
- `executeScript` com `allFrames: true`; candidatos atribuídos a `frameId`/`frameUrl`; mesmo vídeo em dois frames não duplica.
- O retrato de cada frame inclui as origens `http(s)` de `<iframe src>` diferentes da origem do próprio frame (`crossOriginFrames`).
- Resposta de `detect` ganha `access.blockedOrigins`: origens de iframe vistas e ainda sem permissão de host.
- Popup: estado "acesso necessário" com a lista de origens e o botão de conceder (`permissions.request` por gesto); ao conceder, repete `detect`; ao negar, mostra mensagem.
- Manifestos por flavor conforme ADR-0012: `local` com `host_permissions` http(s); `public` com `optional_host_permissions` http(s) e sem `host_permissions`.
- Harness E2E: fixture com iframe de outra origem (`localhost` vs `127.0.0.1`), rede isolada liberando também `localhost`, cópia de teste do build `public` conforme SPEC-0005.

**Não-objetivos (fora do escopo):**
- Detecção por rede (SPEC-0010), HLS (SPEC-0011/0012).
- Revogar permissões pelo popup (o usuário usa `chrome://extensions` → Detalhes → Acesso ao site).
- Vídeos em Shadow DOM fechado ou dentro de `<object>/<embed>`.
- Iframes `about:blank`, `srcdoc`, `data:` e `javascript:` (não têm origem de rede própria).

## 3. Dependências
- **Implementações necessárias:** SPEC-0005 — contratos `VideoCandidate`/mensagens, popup, harness E2E.
- **Contratos consumidos:** N/A
- **Pré-requisitos externos:** N/A (o diálogo nativo de permissão é verificado manualmente no G6).

## 4. Decisão Arquitetural
**Contexto:** Projeto novo; ADR-0012 (permissões por flavor), ADR-0007 (permissões e mensagens), ADR-0001 (fronteiras), ADR-0011 (flavors). Referência: padrão de SPEC-0005 (`src/core` puro + portas em `entrypoints/`).

**Decisão:** a lógica de frames (extração de origens, mescla por frame, cálculo de origens bloqueadas, pedido de acesso) vive em `src/core` com portas (`ScriptingPort.collectVideos(tabId)` passa a devolver `FrameSnapshot[]`; nova `PermissionsPort { contains(origins), request(origins) }`); as implementações sobre `browser.*` ficam em `entrypoints/`. O popup chama `browser.permissions.request` no próprio contexto da página do popup (exigência de gesto do usuário) através do helper de core `requestAccess`.

**Justificativa:** mantém as fronteiras do ADR-0001 e permite testar frames e permissões sem Chrome.

**Desvio do padrão existente:** o manifesto `public` ganha `optional_host_permissions` e o `local` ganha `host_permissions` — previsto no ADR-0012, que refina a regra do ADR-0007; o teste SPEC-0005:IT-04 (que exigia manifestos sem host permissions) é atualizado por esta spec.

**Alternativas descartadas:** `webNavigation.getAllFrames` para enumerar frames (permissão extra e redundante com `crossOriginFrames`); pedir `*://*/*` inteiro no público (viola o ADR-0012).

**ADRs:** ADR-0012, ADR-0007, ADR-0011, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** `detect` com 5 frames e 20 vídeos < 700 ms do clique ao render — medido no E2E-01.
- **Segurança:** pedido de permissão só por gesto do usuário e só para origens vistas na própria página (nunca `*`); candidatos continuam resolvidos por id no servidor; mensagens validadas — UT-04, IT-02.
- **Privacidade e dados pessoais:** só **origens** (esquema+host+porta) trafegam como "bloqueadas"; logs sem caminho nem query; a extensão não guarda permissões concedidas nem origens (o Chrome as guarda) — IT-06.
- **Disponibilidade e resiliência:** frame sem acesso ou que recarrega durante a injeção é ignorado sem derrubar os demais; nenhum frame acessível → `RESTRICTED_PAGE` — IT-01.
- **Acessibilidade (UI):** bloco de acesso navegável por teclado, botão com nome acessível, axe sem violações serious/critical no estado "acesso necessário" — E2E-02.
- **Custo:** N/A — sem serviços.

## 6. Artefato A — Contrato
**Interface:** `PageSnapshot.crossOriginFrames` · `VideoCandidate.frameId/frameUrl` · resposta de `detect` · `PermissionsPort` · manifestos por flavor · popup

```ts
// src/core/contracts — versão 2 (aditiva sobre a v1 de SPEC-0005)
interface PageSnapshot { pageUrl: string; pageTitle: string; videos: VideoSnapshot[];
                         crossOriginFrames: string[] }          // origens 'https://host[:porta]' de <iframe src> http(s) com origem diferente da do frame
interface FrameSnapshot { frameId: number; snapshot: PageSnapshot }
interface VideoCandidate { /* v1 */ frameId: number; frameUrl: string }   // frame 0 = principal
// id do candidato continua hash(tabId, mediaUrl): a mesma URL em dois frames é um candidato só (vale o menor frameId)

// {type:'detect', tabId} →
{ ok: true, candidates: VideoCandidate[], access: { blockedOrigins: string[] } }
| { ok: false, error: 'RESTRICTED_PAGE' }        // nenhum frame acessível ou todos falharam

// blockedOrigins = ⋃ crossOriginFrames(frames acessíveis) − origem do frame principal − origens com permissão (permissions.contains({origins:[o + '/*']}))
//   ordenadas, sem repetição; origens não http(s) descartadas

interface PermissionsPort { contains(origins: string[]): Promise<boolean>; request(origins: string[]): Promise<boolean> }
function requestAccess(port: PermissionsPort, origins: string[]): Promise<{ granted: boolean }>   // origins → padrões 'o/*'; exceção da API = granted:false

// Manifestos (ADR-0012)
local : host_permissions: ['http://*/*','https://*/*']            (sem optional_host_permissions)
public: optional_host_permissions: ['http://*/*','https://*/*']   (sem host_permissions)
// executeScript({ target: { tabId, allFrames: true }, func: collectVideos })  → um resultado por frame com acesso

// Popup (data-testid): access-needed (bloco), access-origin (um por origem), grant-access (botão), access-denied (mensagem)
// Fluxo: blockedOrigins.length > 0 → mostra access-needed (junto aos candidatos já achados) → clique em grant-access → requestAccess → se granted, repete detect
```

**Design:** o bloco "acesso necessário" aparece acima da lista: texto "Esta página tem players em outros sites:" + origens + botão "Permitir acesso"; negado: "Acesso não concedido. Os vídeos desses sites não serão detectados."

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Iframe de mesma origem | vídeo em iframe da mesma origem | candidato com `frameId` ≠ 0 | UT-02, IT-01 |
| Iframe de outra origem, acesso amplo (local) | vídeo em iframe `localhost` na página `127.0.0.1` | candidato listado e baixável | E2E-01 |
| Iframe de outra origem sem acesso (public) | permissão ausente para a origem | `blockedOrigins` com a origem; popup "acesso necessário"; sem candidato do iframe | UT-03, IT-02, E2E-02 |
| Acesso concedido | `requestAccess` → true | repete `detect` e lista o vídeo do iframe | UT-04, E2E-03 |
| Acesso negado | `requestAccess` → false | mensagem de negado, nada muda | UT-04 |
| Mesmo vídeo em dois frames | mesma URL em frame 0 e frame 3 | um candidato (frame 0) | UT-02 |
| Origens inválidas | iframes `about:blank`, `srcdoc`, `data:`, `javascript:`, relativos da mesma origem | ignoradas | UT-01 |
| Frame falha na injeção | um frame lança, outro responde | candidatos do que respondeu; sem erro | IT-01 |
| Nenhum frame acessível | `executeScript` rejeita para tudo | `RESTRICTED_PAGE` | IT-01 |
| Manifestos por flavor | build real | local com host_permissions http(s); public com optional_host_permissions e sem host_permissions | IT-05 |
| Privacidade | origens e candidatos nos logs | só origem (sem caminho/query) | IT-06 |
| Contrato v2 | resposta de `detect` | valida com `access.blockedOrigins` e `frameId`; rejeita sem eles | CT-01 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — SPEC-0005 já cobre o comportamento do frame principal; os testes dela (UT/IT/E2E) são o guarda desta mudança.

### 7.2 Testes Unitários
- **UT-01** — Dado uma lista de `<iframe src>` (https externo, http com porta, mesma origem, relativo, `about:blank`, `data:`, `javascript:`, vazio) e a origem da página, quando `findCrossOriginFrames` é chamado, então devolve só as origens `http(s)` distintas da origem da página, sem repetição e sem caminho/query.
- **UT-02** — Dado snapshots de três frames (principal, mesma origem, outra origem) com uma URL repetida, quando `mergeFrameSnapshots` é chamado, então devolve candidatos com `frameId`/`frameUrl` corretos, a URL repetida aparece uma vez (menor `frameId`) e os ids são estáveis.
- **UT-03** — Dado origens vistas, a origem da página e um conjunto de origens concedidas, quando `computeBlockedOrigins` é chamado, então devolve só as não concedidas, diferentes da página, ordenadas e sem repetição.
- **UT-04** — Dado uma `PermissionsPort` fake que concede, nega ou lança, quando `requestAccess` é chamado, então devolve `granted: true`, `granted: false` e `granted: false` respectivamente, passando os padrões `origem/*`.

### 7.3 Testes de Integração
<!-- Com o background real e o fake de browser.* do WXT. -->
- **IT-01** — Com o background real, `detect` com resultados de `executeScript` de vários frames devolve candidatos de todos; um frame que lança é ignorado; todos lançando devolve `RESTRICTED_PAGE`.
- **IT-02** — Com o background real e `permissions.contains` simulada, `detect` devolve `access.blockedOrigins` com as origens sem permissão e `[]` quando todas estão concedidas.
- **IT-05** — Com `pnpm build` real, o manifesto `local` tem `host_permissions` `http://*/*` e `https://*/*` e nenhuma `optional_host_permissions`; o `public` tem `optional_host_permissions` iguais e nenhuma `host_permissions`; os dois mantêm as permissões da SPEC-0005 e nenhuma outra.
- **IT-06** — Com o logger real, o diagnóstico de um `detect` com iframes contém apenas origens (sem caminho nem query) e `correlationId`.

### 7.4 Testes de Contrato
- **CT-01** — Contrato da resposta de `detect` v2 e de `VideoCandidate` (consumido pela SPEC-0010): o validador aceita `{ ok:true, candidates:[com frameId e frameUrl], access:{ blockedOrigins:[...] } }` e rejeita resposta sem `access`, `frameId` não inteiro ou origem não `http(s)`.

### 7.5 Testes E2E
<!-- Cópia de teste do build conforme SPEC-0005 (Playwright não concede activeTab nem aceita o diálogo de permissão). -->
- **E2E-01** — Build `local`: numa página em `127.0.0.1` com iframe de `localhost` que contém um `<video>` MP4, o popup lista o vídeo e o download salva o arquivo [jornada: baixar-video-em-iframe].
- **E2E-02** — Build `public` (cópia só com `127.0.0.1`): a mesma página mostra o bloco "acesso necessário" com a origem `localhost` e nenhum candidato do iframe; axe sem violações serious/critical.
- **E2E-03** — Build `public` com a origem do iframe liberada na cópia de teste (simula a concessão): o vídeo do iframe aparece e baixa.

### 7.6 Outros
- Verificação manual no G6 (diálogo nativo): no build `public` instalado sem empacotar, abrir https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video, clicar no ícone, ver "acesso necessário" com a origem do iframe, conceder e ver o vídeo; repetir no build `local`, onde o vídeo deve aparecer sem pedir nada. Resultado registrado no Relatório de Entrega.
- Acessibilidade: axe no estado "acesso necessário" (E2E-02).

**Dublês e dados de teste:** fake `browser.*` do WXT com stubs de `scripting.executeScript` (vários frames) e `permissions`; fixtures HTML em `e2e/fixtures/pages/` (página pai + página do iframe com vídeo); servidor de fixtures acessível por `127.0.0.1` e por `localhost` na mesma porta.

**Ambiente de execução:** Vitest (unit/integração) e Playwright com a extensão carregada, local e CI.

## 8. Plano de Rollout
- **Estratégia:** deploy direto numa release rc nova; sem feature flag (o manifesto por flavor já isola o público).
- **Dados/schema:** N/A.
- **Compatibilidade:** contrato de `detect` v2 é aditivo; popup e background são entregues juntos. No Chrome, usuários do build público existente (se houver) recebem um aviso de novas permissões opcionais apenas quando pedidas.
- **Observabilidade:** contadores locais de frames inspecionados e de origens bloqueadas no diagnóstico; sem envio remoto (ADR-0006/0009).
- **Rollback:** nova versão com o código anterior pela pipeline de release (SPEC-0006, runbook seção 4).
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
- [x] Estratégia de permissões — acesso amplo só no build local; por site, em tempo de uso, no público (Thomas, 2026-10-02; ADR-0012)
- [x] Prioridade: melhorar a detecção antes de criar a conta da Web Store? — sim, iframes, rede e HLS primeiro (Thomas, 2026-10-02)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Núcleo de frames**
- [ ] Red: escrever UT-01, UT-02, UT-03, UT-04, CT-01 com a tag `SPEC-0009:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (`src/core`: findCrossOriginFrames, mergeFrameSnapshots, computeBlockedOrigins, requestAccess, contrato v2)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Background e manifestos por flavor**
- [ ] Red: escrever IT-01, IT-02, IT-05, IT-06 com a tag `SPEC-0009:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (allFrames, PermissionsPort, manifestos local/public)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Popup e jornada E2E**
- [ ] Red: escrever E2E-01, E2E-02, E2E-03 com a tag `SPEC-0009:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (bloco de acesso e harness com iframe/origens)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy via pipeline (release rc) com smoke/E2E e a verificação manual do §7.6 (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
<!-- Status: PENDING | PASS | FAIL | N/A. PASS e N/A exigem evidência (comando + resultado, SHA, execução de CI, veredito). -->
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — b3992e6 (árvore suja) | 2026-10-02 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/13]⎯) — 7db456b | 2026-10-02 |
| G2 Green | PASS | build exit 0 (✔ Finished in 215 ms); test exit 0 (Duration  30.61s (tests 98%, import 1%, transform 1%)); lint exit 0 (✔ Finished in 133 ms); coverage exit 0 (================================================================================) — 3673832 | 2026-10-02 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (23 modules, 42 dependencies cruised)) — 3673832 | 2026-10-02 |
| G4 Review | PASS | verify G1+G4: PASS; revisão: reviewer-agent a339d9fd: APPROVED @ 3673832 (0 blocker/major, 6 minor; padrão com porta verificado no Chromium real; mutações de allFrames/blockedOrigins/log detectadas) — 3673832 | 2026-10-02 |
| G5 Integração & CI | PASS | build exit 0 (✔ Finished in 178 ms); test exit 0 (Duration  22.78s (tests 98%, import 1%, transform 1%)); test_integration exit 0 (Duration  3.68s (tests 85%, transform 11%, setup 2%, import 2%)); test_e2e exit 0 (28 passed (28.5s)); arch_test exit 0 (✔ no dependency violations found (23 modules, 42 dependencies cruised)); security_scan exit 0 ([90m3:24PM[0m [32mINF[0m [1mno leaks found[0m) — a2a8a7b | 2026-10-02 |
| H2 Integração aprovada | PENDING | | |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
<!-- Toda parada é registrada pelo Architect com `spec_graph.py impede` e fechada com `resolve` — não edite à mão. Tipos: spec (spec errada/incompleta → resolve com Emenda) | decisão (só o humano decide → resposta ou ADR) | trabalho (falta algo que exige código → SPEC-NNNN nova) | externo (acesso, ambiente, terceiro → ação tomada) | falha (3 FAILs seguidos no mesmo gate → diagnóstico e decisão). Com impedimento aberto a spec aparece como parada no INDEX e não pode ser fechada. -->
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 14. Relatório de Entrega
<!-- Preenchido no CLOSE (G7). Diz o que foi feito, como, e prova que foi resolvido. Para status implemented o validate exige todas as subseções preenchidas, todo teste do plano com PASS + evidência e a Definição de Pronto toda marcada. -->

### O que foi entregue
<!-- comportamento entregue do ponto de vista do usuário/sistema -->

### Como foi feito
<!-- decisões de implementação, módulos/arquivos principais, desvios e emendas (com versão), dívidas assumidas -->

### Prova de Correção
<!-- type fix: o teste de regressão falhou antes da correção (commit red + saída) e passa depois (commit green + execução). Outros tipos: "N/A". -->

### Verificação
<!-- Uma linha por teste do plano (todos os IDs da seção 7). Resultado: PASS. Evidência: execução de CI, commit ou relatório. -->
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
- [ ] Pendências registradas como novas specs (ou nenhuma)

### Deploy
<!-- ambiente(s), versão/tag, data, estratégia, estado da feature flag, execução do pipeline -->

### Pendências
<!-- specs criadas para o que ficou de fora, ou "Nenhuma" -->

## 15. Emendas
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0009`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
