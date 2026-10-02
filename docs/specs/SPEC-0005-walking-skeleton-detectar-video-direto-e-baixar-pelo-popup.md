---
id: SPEC-0005
title: "Walking skeleton: detectar vídeo direto e baixar pelo popup"
tier: full
type: foundation
user_facing: true
status: in-progress
created: 2026-09-30
parent: SPEC-0001
depends_on: [SPEC-0003, SPEC-0004]
consumes_contract: []
contract_version: 1
touches: [package.json, pnpm-lock.yaml, .dependency-cruiser.cjs, e2e/support/**, wxt.config.ts, src/core/**, src/providers/generic/**, src/providers/build/**, entrypoints/**, public/_locales/**, tests/unit/**, tests/integration/**, tests/fixtures/providers/**, e2e/journeys/**, e2e/fixtures/pages/**]
adrs: [ADR-0010, ADR-0011, ADR-0007, ADR-0006, ADR-0009]
external: []
size: M
approved_by: thomas
approved_at: 2026-09-30
---

# SPEC-0005 — Walking skeleton: detectar vídeo direto e baixar pelo popup

## 1. Visão Geral
Primeira jornada real, atravessando todos os contextos da extensão: o usuário abre o popup numa página com `<video>` servido como arquivo (MP4/WebM, sem DRM), vê a lista de vídeos detectados e clica em **Baixar**; o arquivo vai para a pasta de Downloads com nome derivado do título. Vídeo com DRM aparece como **protegido**, sem botão; vídeo por stream (`blob:`/MediaSource) aparece como **ainda não suportado**. Introduz os contratos `Provider`/`VideoCandidate` (ADR-0011), o provider `generic` e o registro de providers por build.

## 2. Motivação & Escopo
**Motivação:** provar a arquitetura de ponta a ponta — manifesto com permissões mínimas, mensagens tipadas, provider, UI, download e diagnóstico — antes de investir em HLS, providers de sites e Drive.

**Objetivos (dentro do escopo):**
- Contratos em `src/core/contracts`: `Provider`, `VideoCandidate`, mensagens `detect`/`download` com validação de schema.
- Provider `generic` (`flavors: [public, local]`): lê `video[src]`, `video > source[src]` e `currentSrc` da aba ativa via `chrome.scripting.executeScript` (acionado ao abrir o popup, com `activeTab`).
- Classificação: URL `http(s)` → `support: downloadable`; `blob:`/MediaSource → `support: unsupported-stream`; `video.mediaKeys` não nulo ou evento `encrypted` observado → `protection: drm` (nunca baixável).
- Plugin de build em `src/providers/build/` que gera o módulo virtual `virtual:providers` só com providers cujo `provider.json` inclui o FLAVOR do build (ADR-0011) — aceita `PROVIDERS_EXTRA_DIR` para testes.
- Background: agrega candidatos por aba (memória, descartados ao fechar a aba), inicia `chrome.downloads.download` com nome sanitizado.
- Popup pt-BR/en: lista (título, tipo, tamanho se conhecido), estados vazio/protegido/não suportado/página restrita, acessível por teclado.
- Diagnóstico local (ADR-0009): logger estruturado com ID de correlação, URLs registradas sem query string, botão "Copiar diagnóstico".
- Permissões: `activeTab`, `scripting`, `downloads`, `storage` — sem `host_permissions`.

**Não-objetivos (fora do escopo):**
- HLS/DASH, escolha de qualidade, barra de progresso própria (épico do detector genérico).
- Detecção automática sem clique (exigiria host permissions).
- Providers de sites, YouTube, Google Drive.
- Qualquer tratamento de conteúdo com DRM além de marcá-lo como protegido.

## 3. Dependências
- **Implementações necessárias:** SPEC-0003 — harness de testes e fixture de extensão; SPEC-0004 — CI obrigatório para os PRs desta spec.
- **Contratos consumidos:** N/A
- **Pré-requisitos externos:** N/A

## 4. Decisão Arquitetural
**Contexto:** Projeto novo; ADR-0010 (stack), ADR-0011 (providers/builds), ADR-0001 (fronteiras), ADR-0007 (permissões), ADR-0006 (dados), ADR-0009 (diagnóstico).

**Decisão:** `src/core` puro (contratos, classificação, sanitização, agregação) com portas `DownloadPort`, `ScriptingPort`, `LogPort` implementadas em `entrypoints/background` sobre `browser.*`; provider `generic` em `src/providers/generic`; popup fala só com o background por mensagens do contrato.

**Justificativa:** o núcleo testável sem Chrome (unit) e as portas testadas com fake/real (integração, E2E) seguem as regras do ADR-0001.

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:** content script declarado em `<all_urls>` (exige host permission ampla — ADR-0007); `fetch` + `Blob` no service worker para baixar (limite de memória do MV3 e reenvio de dados; `chrome.downloads` usa a URL original).

**ADRs:** ADR-0010, ADR-0011, ADR-0007, ADR-0006, ADR-0009.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** popup lista candidatos em < 500 ms após abrir numa página com até 20 `<video>` — medido no E2E-01 (`performance.now`).
- **Segurança:** mensagens aceitas só de `sender.id === browser.runtime.id`; payload validado pelo schema; manifesto sem `host_permissions`, sem CSP relaxada, sem código remoto — UT-04, IT-03, IT-04.
- **Privacidade e dados pessoais:** URLs de páginas/mídia só em memória por aba; nenhuma requisição de rede feita pela extensão além do download pedido; logs sem query string — IT-05, IT-06.
- **Disponibilidade e resiliência:** service worker efêmero — estado reconstruído por nova detecção ao reabrir o popup; falha de download mostra erro com motivo (`DOWNLOAD_FAILED`) — IT-02.
- **Acessibilidade (UI):** popup navegável por teclado, botões com nome acessível, contraste AA; axe sem violações serious/critical — E2E-01 (7.6).
- **Custo:** N/A — sem serviços.

## 6. Artefato A — Contrato
**Interface:** `Provider` · `VideoCandidate` · mensagens `detect`/`download` · `virtual:providers` · popup

```ts
// src/core/contracts — versão 1
type Flavor = 'public' | 'local';
interface ProviderManifest { id: string; flavors: Flavor[] }            // provider.json
interface Provider extends ProviderManifest {
  matches(url: URL): boolean;
  detect(ctx: { tabId: number; pageUrl: string; scripting: ScriptingPort }): Promise<VideoCandidate[]>;
}
interface VideoCandidate {
  id: string;                    // hash estável de (tabId, mediaUrl)
  providerId: string; tabId: number; pageUrl: string;
  mediaUrl: string;              // http(s) ou 'blob:' (não baixável)
  title?: string; mimeType?: string; sizeBytes?: number;
  protection: 'none' | 'drm';
  support: 'downloadable' | 'unsupported-stream';
}
// virtual:providers — gerado no build
export const providers: Provider[];   // só os com FLAVOR ∈ flavors; ordem: específicos antes de 'generic'

// Mensagens popup → background (validadas; sender.id deve ser a própria extensão)
{ type: 'detect', tabId }                 → { ok: true, candidates: VideoCandidate[] }
                                          | { ok: false, error: 'RESTRICTED_PAGE' }      // chrome://, Web Store, PDF viewer — sem `tabs`/host permission `tab.url` é indefinido: a restrição é detectada pelo erro do `executeScript`
{ type: 'download', candidateId }         → { ok: true, downloadId: number }
                                          | { ok: false, error: 'CANDIDATE_NOT_FOUND' | 'PROTECTED' | 'UNSUPPORTED' }
                                          | { ok: false, error: 'DOWNLOAD_FAILED', reason: string }
{ type: 'diagnostics' }                   → { ok: true, entries: LogEntry[] }
mensagem inválida ou de outra origem       → { ok: false, error: 'INVALID_MESSAGE' } (e log)

// Nome do arquivo: sanitize(title ?? último segmento da URL) + extensão pelo mimeType/URL;
// sem / \ : * ? " < > |, máx. 120 caracteres; fallback "video-<data>.mp4"
```

**Alvo do popup:** o popup lê `?tabId=<n>` da própria URL quando presente e usa a aba ativa (`tabs.query`) caso contrário; os testes E2E abrem `popup.html?tabId=<n>`. Elementos da UI expõem `data-testid`: `candidate-list`, `candidate-item`, `download-button`, `badge-drm`, `badge-unsupported`, `empty-state`, `restricted-state`, `copy-diagnostics`.

**Design:** popup 360 px: cabeçalho com nome da extensão; lista de cartões (título, badge `MP4`/`WebM`, tamanho, botão **Baixar**); badges **Protegido (DRM)** e **Ainda não suportado** sem botão; estado vazio "Nenhum vídeo encontrado nesta página"; estado restrito "O Chrome não permite extensões nesta página"; rodapé com "Copiar diagnóstico". Protótipo detalhado fica a cargo do implementador dentro destas regras (revisto no G4).

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Vídeo direto | página com `<video src=x.mp4>` | candidato `downloadable`, listado no popup; Baixar salva arquivo | UT-01, IT-01, E2E-01 |
| `<source>` múltiplos | `<video>` com 2 `<source>` | um candidato por URL distinta, sem duplicar `currentSrc` | UT-02 |
| DRM | `video.mediaKeys` definido | badge Protegido, sem botão; `download` responde `PROTECTED` | UT-01, IT-02, E2E-02 |
| Stream MSE | `src` `blob:` | badge Ainda não suportado; `download` responde `UNSUPPORTED` | UT-01, IT-02 |
| Nenhum vídeo | página sem `<video>` | estado vazio | E2E-03 |
| Página restrita | `chrome://extensions` | `RESTRICTED_PAGE`, mensagem no popup | IT-07, E2E-04 |
| Candidato inexistente | `candidateId` desconhecido | `CANDIDATE_NOT_FOUND` | IT-02 |
| Falha do download | `downloads.download` rejeita | `DOWNLOAD_FAILED` + motivo no popup | IT-02 |
| Nome de arquivo | título com `/:*?` e 300 caracteres | nome sanitizado ≤ 120 + extensão | UT-03 |
| Mensagem inválida/externa | payload fora do schema ou outro `sender.id` | `INVALID_MESSAGE`, nada executado | UT-04, IT-03 |
| Registro por build | provider `flavors:[local]` | fora de `virtual:providers` no build public | UT-05, CT-01 |
| Manifesto mínimo | build public e local | sem `host_permissions`/`<all_urls>`, CSP padrão | IT-04 |
| Privacidade de logs | download com URL `?token=abc` | log sem query string | IT-05 |
| Sem rede própria | fluxo completo | nenhuma requisição da extensão exceto o download | IT-06 |
| Estado por aba | aba fechada | candidatos da aba descartados | UT-06 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — projeto novo.

### 7.2 Testes Unitários
- **UT-01** — Dado um snapshot de `<video>` com `src` http(s), `blob:` ou `mediaKeys` definido, quando `classify` é chamado, então retorna respectivamente `downloadable/none`, `unsupported-stream/none` e `protection: drm`.
- **UT-02** — Dado `<video>` com `currentSrc` igual a um dos dois `<source>`, quando o provider `generic` extrai candidatos, então retorna 2 candidatos com URLs distintas e IDs estáveis.
- **UT-03** — Dado títulos com caracteres proibidos, vazios ou com 300 caracteres, quando `toFilename` é chamado, então retorna nome válido ≤ 120 caracteres com extensão correta, ou o fallback `video-<data>.mp4`.
- **UT-04** — Dado mensagens fora do schema ou com `sender.id` diferente, quando `validateMessage` é chamado, então rejeita com `INVALID_MESSAGE`.
- **UT-05** — Dado manifests de providers `[public, local]`, `[local]` e `[public]`, quando o gerador de `virtual:providers` roda para FLAVOR `public`, então inclui só os que contêm `public`, com `generic` por último.
- **UT-06** — Dado candidatos de duas abas, quando a aba 1 é fechada, então o agregador mantém só os da aba 2.

### 7.3 Testes de Integração
- **IT-01** — Com o background real e o fake de `browser.*`, `detect` para uma aba com a página-fixture retorna o candidato, e `download` chama `downloads.download` com a URL original e o nome sanitizado.
- **IT-02** — Com o background real, `download` responde `PROTECTED`, `UNSUPPORTED`, `CANDIDATE_NOT_FOUND` e `DOWNLOAD_FAILED` (fake de `downloads` rejeitando) conforme o candidato.
- **IT-03** — Com o background real, mensagem com `sender.id` de outra extensão ou payload inválido não chama nenhuma porta e responde `INVALID_MESSAGE`.
- **IT-04** — Com `pnpm build` real, o `manifest.json` de `public` e de `local` não tem `host_permissions` nem `<all_urls>`, tem só `activeTab, scripting, downloads, storage` e nenhuma CSP customizada.
- **IT-05** — Com o logger real, após um download de URL com `?token=abc`, nenhuma entrada do diagnóstico contém `token=` e todas têm `correlationId`.
- **IT-06** — No Chromium com a extensão carregada, durante E2E-01, o registro de requisições do service worker contém apenas o download do fixture.
- **IT-07** — No Chromium com a extensão carregada, `detect` para uma aba em `chrome://extensions` responde `RESTRICTED_PAGE`.

### 7.4 Testes de Contrato
- **CT-01** — O contrato `ProviderManifest`/`virtual:providers` v1 consumido por SPEC-0006: construindo com `PROVIDERS_EXTRA_DIR` apontando para um provider-fixture `flavors:[local]`, o bundle `public` não contém o identificador do fixture e o `local` contém; o schema de `provider.json` rejeita `flavors` vazio ou com valor desconhecido.

### 7.5 Testes E2E
<!-- Emenda 1 (teste): o Playwright não consegue conceder `activeTab` (só a invocação real do usuário concede). Os E2E e o IT-06 rodam contra uma CÓPIA do build em que o harness (`e2e/support/**`) acrescenta `host_permissions: ["http://127.0.0.1/*"]` ao manifest; o build distribuído e o IT-04 continuam sem `host_permissions`. -->
- **E2E-01** — Usuário abre a página-fixture com MP4, abre o popup, vê o vídeo listado com título e badge MP4, clica em Baixar e o arquivo com o nome esperado aparece no diretório de downloads com o tamanho do fixture (builds public e local) [jornada: baixar-video-direto].
- **E2E-02** — Usuário abre página-fixture com vídeo que usa EME (Clear Key de teste, sem conteúdo real) e o popup mostra "Protegido (DRM)" sem botão de download.
- **E2E-03** — Usuário abre página sem vídeo e o popup mostra "Nenhum vídeo encontrado nesta página".
- **E2E-04** — Usuário abre o popup em `chrome://extensions` e vê "O Chrome não permite extensões nesta página".

### 7.6 Outros
- Verificação manual no G6 (não automatizável): com o build `local` e o `public` instalados sem empacotar, clicar no ícone da extensão numa página com `<video src=*.mp4>` mostra o vídeo e baixa o arquivo — prova o grant de `activeTab` que os E2E não cobrem. Resultado e data registrados no Relatório de Entrega.
- Acessibilidade: axe-core (`@axe-core/playwright`) no popup durante E2E-01 e E2E-02 — zero violações serious/critical; navegação só por teclado até o botão Baixar.
- Desempenho: tempo entre abrir o popup e a lista renderizada < 500 ms, medido no E2E-01.

**Dublês e dados de teste:** fake `browser.*` do WXT (IT-01..IT-05); fixtures HTML em `e2e/fixtures/pages/` (MP4 de 2 s gerado, página EME Clear Key, página vazia); provider-fixture `local` em `tests/fixtures/providers/` via `PROVIDERS_EXTRA_DIR`.

**Ambiente de execução:** unit/integração no Vitest; IT-06, IT-07 e E2E no Chromium do Playwright com a extensão carregada, local e no CI.

## 8. Plano de Rollout
- **Estratégia:** deploy direto — publicada junto com a primeira release (`0.1.0`) por SPEC-0006.
- **Dados/schema:** N/A — só estado em memória; `chrome.storage` ainda não usado para dados persistentes.
- **Compatibilidade:** contrato v1 de `Provider`/mensagens; mudanças futuras por emenda com `contract_version`.
- **Observabilidade:** diagnóstico local com contadores por provider (detecções, downloads iniciados/falhos) e ID de correlação (ADR-0009).
- **Rollback:** republicar a versão anterior pela pipeline de SPEC-0006 (loja não aceita downgrade: nova versão com o código da tag anterior).
- **Etapas de migração/coexistência:** N/A

## 9. Questões em Aberto
- [x] Idiomas do popup — pt-BR e en via `_locales` (Thomas, 2026-09-30)
- [x] Quais providers entram no build público? — só o `generic`; cursos e YouTube só no `local` (Thomas, 2026-09-30)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Núcleo (contratos, classificação, nome, agregação)**
- [ ] Red: escrever UT-01, UT-02, UT-03, UT-04, UT-05, UT-06 com a tag `SPEC-0005:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Background, logger e manifesto**
- [ ] Red: escrever IT-01, IT-02, IT-03, IT-04, IT-05, CT-01 com a tag `SPEC-0005:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Popup e jornada E2E**
- [ ] Red: escrever E2E-01, E2E-02, E2E-03, E2E-04, IT-06, IT-07 com a tag `SPEC-0005:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy via pipeline (release rc de SPEC-0006) com smoke/E2E no artefato (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — ? | 2026-09-30 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[24/24]⎯) — ad36e26 | 2026-10-02 |
| G2 Green | PASS | build exit 0 (✔ Finished in 191 ms); test exit 0 (Duration  21.21s (tests 98%, import 1%, transform 1%)); lint exit 0 (✔ Finished in 143 ms); coverage exit 0 (================================================================================) — ce4e141 | 2026-10-02 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (20 modules, 33 dependencies cruised)) — ce4e141 | 2026-10-02 |
| G4 Review | PASS | verify G1+G4: PASS; revisão: reviewer-agent a06c570d: APPROVED @ ce4e141 (0 blocker/major, 6 minor; id do provider local ausente do bundle public verificado; IT-06 provado não-vazio por mutação) — ce4e141 | 2026-10-02 |
| G5 Integração & CI | PASS | build exit 0 (✔ Finished in 205 ms); test exit 0 (Duration  24.02s (tests 98%, import 1%, transform 1%)); test_integration exit 0 (Duration  2.75s (tests 88%, transform 8%, setup 2%, import 2%)); test_e2e exit 0 (23 passed (22.3s)); arch_test exit 0 (✔ no dependency violations found (20 modules, 33 dependencies cruised)); security_scan exit 0 ([90m12:06PM[0m [32mINF[0m [1mno leaks found[0m) — 9fbf44f | 2026-10-02 |
| H2 Integração aprovada | PASS | política auto-on-green (aprovada por thomas em 2026-10-02); G5 PASS | 2026-10-02 |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|
| IMP-01 | 2026-09-30 | G1 | decisão | E2E-01/02/03 e IT-06 não são automatizáveis com o manifesto da spec (sem host_permissions): activeTab só é concedido por invocação real do usuário; popup como aba com ?tabId= e chrome.action.openPopup() via SW não recebem o grant (probe no Chromium real) | popup como aba com ?tabId=; chrome.action.openPopup() pelo service worker; executeScript pelo SW antes/depois; nenhum obtém o grant | Thomas (decisão sobre como provar a jornada) + Architect (emenda) | Decisão do Thomas (2026-09-30): cópia de teste com host 127.0.0.1 só nos E2E; Emenda 1 (teste) na SPEC-0005 | 2026-09-30 |

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
- [ ] Pendências registradas como novas specs (ou nenhuma)

### Deploy

### Pendências

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
| 1 (escopo) | 2026-09-30 | `touches` inclui `package.json`/`pnpm-lock.yaml` (única dependência nova: `@axe-core/playwright`, já exigida no §7.6), `.dependency-cruiser.cjs` (o módulo virtual `virtual:providers` precisa de exceção em `not-to-unresolvable`, sem afrouxar as regras do ADR-0001) e `e2e/support/**` | necessidades descobertas ao planejar a onda 3 contra o harness real da SPEC-0003 | SPEC-0006 (nenhuma: arquivos distintos) | pendente de ratificação do Thomas no H2 da onda 3 |
| 1 (teste) | 2026-09-30 | E2E e IT-06 rodam contra cópia do build com `host_permissions` para `http://127.0.0.1/*` adicionada só pelo harness; popup aceita `?tabId=<n>`; `data-testid` fixados; `activeTab` verificado manualmente no G6 | `activeTab` só é concedido por clique real do usuário; probe no Chromium real provou que `?tabId=` e `action.openPopup()` não obtêm o grant | SPEC-0006 (nenhuma) | thomas (escolha da opção 1 no chat, 2026-09-30) |
| 2 (esclarecimento) | 2026-10-02 | o registro do flavor `local` inclui todos os providers (superset do `public`); o `public` inclui só os que declaram `public`, com `generic` por último | o teste UT-05 e o README definem o `local` como superset; a leitura estrita deixaria um provider `public`-only fora do build local | SPEC-0006 (flavor-guard lê o mesmo `provider.json`; sem efeito) | thomas (delegação no chat, 2026-10-02: seguir o recomendado) |
