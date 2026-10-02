---
id: SPEC-0010
title: Detecção por rede (media sniffing)
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-02
parent: SPEC-0008
depends_on: []
consumes_contract: [SPEC-0009@1]
contract_version: 1
touches: [wxt.config.ts, .dependency-cruiser.cjs, src/core/**, entrypoints/**, public/_locales/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**]
adrs: [ADR-0012, ADR-0009, ADR-0006, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-02
---

# SPEC-0010 — Detecção por rede (media sniffing)

<!-- type: feature | fix | refactor | migration | foundation. user_facing: true quando a mudança altera uma jornada do usuário (UI ou API pública) — exige teste E2E. Substitua todos os marcadores com chaves duplas: o G0 (`spec_graph.py validate`) reprova a spec enquanto restar algum. As seções de Checklist em diante são preenchidas depois da aprovação, sem marcadores. -->

## 1. Visão Geral
Além de ler o DOM, a extensão passa a **observar as respostas de rede** da aba (`webRequest`, só leitura) e registra URLs de mídia: arquivos de vídeo (`.mp4`/`.webm`/`video/*`), playlists HLS (`.m3u8`) e manifestos DASH (`.mpd`). Isso encontra o que nunca aparece como `<video src>` (players com MSE/`blob:`, vídeo carregado por JavaScript, iframes cujo DOM não alcançamos). Os achados vão para um repositório por aba que sobrevive à suspensão do service worker e se junta aos candidatos do DOM.

## 2. Motivação & Escopo
**Motivação:** a maioria dos players modernos usa `blob:`/MSE; a URL real só é visível na rede. Sem isso, a lista fica vazia justamente nas plataformas mais úteis.

**Objetivos (dentro do escopo):**
- Permissão `webRequest` (observação, não bloqueante) nos dois flavors; no `public` ela só enxerga origens com permissão de host concedida (ADR-0012).
- `classifyNetworkResponse`: transforma uma resposta (URL, método, status, `Content-Type`, `Content-Length`/`Content-Range`) em candidato `file`/`hls`/`dash` ou descarta (segmentos `.ts/.m4s/.aac`, imagens, requisições pequenas demais, erros, não-GET).
- Repositório por aba em `storage.session` (máx. 50 itens, mais recentes), limpo ao fechar a aba e ao navegar o frame principal.
- `detect` devolve DOM ∪ rede, sem duplicar a mesma URL; candidato de rede `file` baixa como os do DOM; `hls`/`dash` aparecem como "ainda não suportado" até SPEC-0011/0012.
- `VideoCandidate` ganha `kind` (`file | hls | dash`) e `source` (`dom | network`).

**Não-objetivos (fora do escopo):**
- Ler corpo de resposta, bloquear ou modificar requisições, capturar cabeçalhos de autenticação.
- Baixar HLS/DASH (SPEC-0011/0012; DASH fica para um épico futuro).
- Detectar áudio puro como vídeo.

## 3. Dependências
- **Implementações necessárias:** SPEC-0009 — `detect` v2 (frames, acesso por flavor) e harness com iframe/origens.
- **Contratos consumidos:** N/A
- **Pré-requisitos externos:** N/A

## 4. Decisão Arquitetural
**Contexto:** Projeto novo; ADR-0012 (permissões), ADR-0009 (diagnóstico local), ADR-0006 (privacidade), ADR-0001. Referência: portas em `entrypoints/` e lógica pura em `src/core` (SPEC-0005/0009).

**Decisão:** `classifyNetworkResponse`, `NetworkStore` (sobre uma `SessionStoragePort`) e `mergeCandidates` em `src/core`; os listeners de `webRequest` e a porta de `storage.session` em `entrypoints/background`. Os listeners são registrados no topo do módulo do service worker para acordá-lo; o estado fica em `storage.session`, pois o service worker é suspenso após ~30 s ociosos.

**Justificativa:** `storage.session` fica só em memória do navegador (não vai a disco) e sobrevive à suspensão; evita estado perdido que deixaria a lista vazia.

**Desvio do padrão existente:** o diagnóstico em memória da SPEC-0005 continua; só o repositório de rede usa `storage.session`. Nova permissão `webRequest` (ADR-0012 permite novas permissões com a spec que as usa).

**Alternativas descartadas:** `webRequest` bloqueante (proibido no MV3 para extensões comuns e desnecessário); `declarativeNetRequest` (não expõe respostas); guardar em variáveis do service worker (perde estado ao suspender).

**ADRs:** ADR-0012, ADR-0009, ADR-0006, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** classificar uma resposta < 1 ms; listener sem trabalho além de classificar e, se aceita, gravar; no máximo 50 itens por aba — medido em UT-02.
- **Segurança:** só observação; nenhuma requisição própria; candidatos resolvidos por id no servidor (como SPEC-0005); URLs aceitas apenas `http(s)` — UT-01, IT-01.
- **Privacidade e dados pessoais:** URLs completas (podem ter token) ficam só em `storage.session` e na memória; logs/diagnóstico sem query; nada vai para disco nem para fora do navegador — IT-05.
- **Disponibilidade e resiliência:** estado sobrevive à suspensão do service worker (IT-02); eventos de abas inexistentes ou sem `tabId` (-1) são ignorados.
- **Acessibilidade (UI):** itens de rede usam os mesmos componentes e rótulos acessíveis — E2E-01 (axe).
- **Custo:** N/A.

## 6. Artefato A — Contrato
**Interface:** `classifyNetworkResponse` · `NetworkStore` · `mergeCandidates` · `VideoCandidate.kind/source` · permissão `webRequest`

```ts
// src/core/contracts — versão 3 (aditiva)
type MediaKind = 'file' | 'hls' | 'dash';
interface VideoCandidate { /* v2 */ kind: MediaKind; source: 'dom' | 'network' }
// support: kind 'file' → 'downloadable' (se http(s)); 'hls' | 'dash' → 'unsupported-stream' (até SPEC-0011/0012)

interface NetworkResponse { url: string; method: string; statusCode: number; tabId: number; frameId: number;
                            contentType?: string; contentLength?: number /* de Content-Length ou total de Content-Range */ }
function classifyNetworkResponse(r: NetworkResponse): { kind: MediaKind; mimeType?: string; sizeBytes?: number } | null
//  descarta: método ≠ GET; status fora de 200/206; esquema não http(s); tabId < 0;
//            segmentos (.ts .m4s .aac .m4a .mp3 .vtt) e imagens; kind 'file' com tamanho conhecido < 100 KiB
//  file : Content-Type video/mp4|video/webm|video/ogg  OU  extensão .mp4 .webm .m4v .ogv (sem query) com Content-Type video/* ou application/octet-stream
//  hls  : Content-Type application/vnd.apple.mpegurl | application/x-mpegurl | audio/mpegurl  OU  extensão .m3u8
//  dash : Content-Type application/dash+xml  OU  extensão .mpd

interface SessionStoragePort { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; remove(key: string): Promise<void> }
class NetworkStore { constructor(port: SessionStoragePort, now?: () => number)
  add(tabId: number, c: VideoCandidate): Promise<void>      // dedupe por URL sem fragmento; máx. 50 por aba (descarta os mais antigos)
  forTab(tabId: number): Promise<VideoCandidate[]>           // mais recentes primeiro
  clear(tabId: number): Promise<void> }                       // chave 'vd:net:<tabId>'
function mergeCandidates(dom: VideoCandidate[], network: VideoCandidate[]): VideoCandidate[]   // dedupe por URL sem fragmento; DOM prevalece

// Eventos (entrypoints/background): webRequest.onResponseStarted({urls:['http://*/*','https://*/*']}, ['responseHeaders'])
//   → classifica → NetworkStore.add; webRequest.onBeforeRequest(type 'main_frame') → clear(tabId); tabs.onRemoved → clear(tabId)
// detect: candidates = mergeCandidates(DOM de todos os frames, NetworkStore.forTab(tabId))
```

**Design:** itens de rede aparecem na mesma lista, com o selo do tipo (`MP4`, `WebM`, `HLS`, `DASH`); HLS/DASH com o selo "Ainda não suportado" (`badge-unsupported`) até as specs seguintes.

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| MP4 por Content-Type | `video/mp4`, 200, GET | candidato `file` com tamanho | UT-01, IT-01 |
| MP4 por extensão | `.mp4?x=1` com `application/octet-stream` | candidato `file` | UT-01 |
| Playlist HLS | `application/vnd.apple.mpegurl` ou `.m3u8` | candidato `hls`, não suportado | UT-01, E2E-02 |
| Manifesto DASH | `.mpd` | candidato `dash`, não suportado | UT-01 |
| Segmentos e imagens | `.ts`, `.m4s`, `.jpg` | descartados | UT-01 |
| Resposta 206 com Content-Range | `bytes 0-99/5000000` | tamanho = total (5000000) | UT-01 |
| Arquivo minúsculo | `video/mp4` de 2 KiB | descartado | UT-01 |
| Não-GET / erro / não http(s) / tabId -1 | POST, 404, `blob:`, tabId -1 | descartados | UT-01 |
| Limite por aba | 60 itens | guarda os 50 mais recentes | UT-02 |
| Duplicata | mesma URL, fragmentos diferentes | um item | UT-02, UT-03 |
| DOM + rede | mesma URL nas duas fontes | um candidato, `source: 'dom'` | UT-03 |
| Navegação | `main_frame` da aba | lista da aba limpa | IT-03, E2E-03 |
| Aba fechada | `tabs.onRemoved` | lista descartada | IT-03 |
| Service worker suspenso | novo background com o mesmo `storage.session` | lista preservada | IT-02 |
| Permissões | build real | `webRequest` nos dois flavors, nada além do previsto | IT-04 |
| Privacidade | URL com `?token=` | logs sem query | IT-05 |
| Vídeo via MSE/blob | `<video src="blob:...">` + fetch de `/media/x.mp4` | candidato de rede `file` listado e baixável | E2E-01 |
| Contrato v3 | candidato com `kind` e `source` | validador aceita; rejeita kind desconhecido | CT-01 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — os testes de SPEC-0005/0009 guardam o comportamento do DOM.

### 7.2 Testes Unitários
- **UT-01** — Dado respostas de rede de cada cenário do Mapa (tabela), quando `classifyNetworkResponse` é chamado, então devolve o `kind`/tamanho esperados ou `null`.
- **UT-02** — Dado um `NetworkStore` sobre uma porta em memória, quando 60 candidatos e duplicatas são adicionados e `clear` é chamado, então guarda no máximo 50 mais recentes, sem duplicatas, e `clear` esvazia só a aba indicada.
- **UT-03** — Dado listas de DOM e de rede com URLs repetidas (inclusive só com fragmento diferente), quando `mergeCandidates` é chamado, então não há duplicatas e vale o candidato do DOM.

### 7.3 Testes de Integração
- **IT-01** — Com o background real e `fakeBrowser`, eventos `webRequest.onResponseStarted` de MP4, HLS e imagem resultam em `detect` listando só MP4 e HLS (`unsupported-stream`), e `download` do MP4 de rede chama `downloads.download` com a URL.
- **IT-02** — Com o repositório em `storage.session` do fake, recriar o background (simula suspensão do service worker) mantém a lista de rede da aba.
- **IT-03** — Um `onBeforeRequest` de `main_frame` limpa a lista da aba; `tabs.onRemoved` descarta a lista.
- **IT-04** — Com `pnpm build` real, ambos os manifestos têm exatamente as permissões `activeTab, scripting, downloads, storage, webRequest`, e a política de host de cada flavor da SPEC-0009 permanece.
- **IT-05** — Com o logger real, o diagnóstico depois de eventos de rede com `?token=...` não contém `token=`; todas as entradas têm `correlationId`.

### 7.4 Testes de Contrato
- **CT-01** — Contrato de `VideoCandidate` v3 (consumido pela SPEC-0011): o validador aceita `kind ∈ {file,hls,dash}` e `source ∈ {dom,network}` e rejeita valores desconhecidos ou ausentes.

### 7.5 Testes E2E
- **E2E-01** — Numa página cujo `<video>` usa `blob:` (MediaSource) e cujo script faz `fetch` de um MP4 do servidor de fixtures, o popup lista o MP4 de rede e o download salva o arquivo; build `local` e `public` (cópia de teste com a origem liberada) [jornada: baixar-video-direto].
- **E2E-02** — Quando a página requisita uma playlist `.m3u8` do fixture, o popup a lista com o selo "HLS" e `badge-unsupported`, sem botão de download.
- **E2E-03** — Depois de navegar a aba para outra página, a lista não contém mais os itens da anterior.

### 7.6 Outros
- Verificação manual no G6: em um site real com player MSE sem DRM, abrir o popup depois de dar play e conferir que o arquivo/playlist aparece (registrar o site e o resultado no Relatório de Entrega).
- Acessibilidade: axe no popup com itens de rede (E2E-01).

**Dublês e dados de teste:** fake `browser.webRequest`/`storage.session`; fixtures HTML e MP4/`.m3u8` em `e2e/fixtures/`; servidor de fixtures com `Content-Type` configurável por rota.

**Ambiente de execução:** Vitest e Playwright com a extensão carregada, local e CI.

## 8. Plano de Rollout
- **Estratégia:** deploy direto numa release rc; sem feature flag.
- **Dados/schema:** `storage.session` com chaves `vd:net:<tabId>` — efêmero, sem migração; descartado ao fechar o navegador.
- **Compatibilidade:** `detect` ganha itens de rede e campos novos; popup e background saem juntos. Nova permissão `webRequest`: o Chrome mostra aviso de permissões ao atualizar o build `local` (que já tem acesso amplo).
- **Observabilidade:** contadores locais de respostas classificadas por tipo e descartadas, no diagnóstico (sem envio remoto).
- **Rollback:** versão anterior pela pipeline de release.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
- [x] Estratégia de permissões do `webRequest` — mesma do ADR-0012: amplo no local, por site concedido no público (Thomas, 2026-10-02)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Classificação e repositório**
- [ ] Red: escrever UT-01, UT-02, UT-03, CT-01 com a tag `SPEC-0010:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (`classifyNetworkResponse`, `NetworkStore`, `mergeCandidates`, contrato v3)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Background com webRequest**
- [ ] Red: escrever IT-01, IT-02, IT-03, IT-04, IT-05 com a tag `SPEC-0010:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (listeners no topo, storage.session, permissão webRequest)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Jornada E2E**
- [ ] Red: escrever E2E-01, E2E-02, E2E-03 com a tag `SPEC-0010:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (popup com itens de rede)
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
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[29/29]⎯) — eeb8c56 | 2026-10-02 |
| G2 Green | PASS | build exit 0 (✔ Finished in 201 ms); test exit 0 (Duration  26.40s (tests 98%, import 1%, transform 1%)); lint exit 0 (✔ Finished in 150 ms); coverage exit 0 (================================================================================) — f472a01 | 2026-10-02 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (25 modules, 48 dependencies cruised)) — f472a01 | 2026-10-02 |
| G4 Review | PENDING | | |
| G5 Integração & CI | PENDING | | |
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
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0010`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
| 1 (dependência) | 2026-10-02 | `depends_on: [SPEC-0009]` passa a `consumes_contract: [SPEC-0009@1]` | a dependência real é o código/contrato já integrado na `main` (SPEC-0009 com G5 e H2); o fechamento (G6 manual e G7) das specs do épico acontece em lote numa única rc no fim, pois a verificação manual exige o Thomas | SPEC-0009 (sem efeito no contrato) | thomas (delegação no chat, 2026-10-02: seguir o recomendado) |
