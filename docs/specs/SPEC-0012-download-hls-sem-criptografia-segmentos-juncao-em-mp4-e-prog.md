---
id: SPEC-0012
title: "Download HLS sem criptografia: segmentos, junção em MP4 e progresso"
tier: full
type: feature
user_facing: true
status: approved
created: 2026-10-02
parent: SPEC-0008
depends_on: []
consumes_contract: [SPEC-0011@1]
contract_version: 1
touches: [package.json, pnpm-lock.yaml, wxt.config.ts, .dependency-cruiser.cjs, src/core/**, entrypoints/**, public/_locales/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**]
adrs: [ADR-0013, ADR-0012, ADR-0008, ADR-0006, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-02
---

# SPEC-0012 — Download HLS sem criptografia: segmentos, junção em MP4 e progresso

<!-- type: feature | fix | refactor | migration | foundation. user_facing: true quando a mudança altera uma jornada do usuário (UI ou API pública) — exige teste E2E. Substitua todos os marcadores com chaves duplas: o G0 (`spec_graph.py validate`) reprova a spec enquanto restar algum. As seções de Checklist em diante são preenchidas depois da aprovação, sem marcadores. -->

## 1. Visão Geral
O usuário escolhe a qualidade de um vídeo HLS sem criptografia, clica em **Baixar**, acompanha o progresso (com cancelamento) e recebe um **arquivo MP4 reproduzível**. O trabalho acontece num *offscreen document*: busca os segmentos em paralelo com retentativas, junta (TS→MP4 com `mux.js`, ou concatena fMP4) e entrega o arquivo ao `chrome.downloads` por uma blob URL.

## 2. Motivação & Escopo
**Motivação:** é o recurso que mais falta ao produto hoje — a maioria dos vídeos de curso e de sites é HLS. Sem juntar segmentos não há download.

**Objetivos (dentro do escopo):**
- Dependência `mux.js` 6.3.0 (ADR-0013), usada só no offscreen; permissão `offscreen` (ADR-0012: permissões novas entram com a spec que as usa).
- Entrypoint `entrypoints/offscreen` (razão `BLOBS`), criado sob demanda e fechado ao fim do último job.
- Jobs de download: `download` com `variantIndex`; progresso por polling (`job`), cancelamento (`cancel`); no máximo 2 jobs simultâneos e 1 por candidato.
- Agendador de segmentos: concorrência 4, 3 retentativas com espera crescente, ordem preservada, abortável.
- Montagem: segmentos TS → MP4 (`mux.js` Transmuxer, H.264/AAC); fMP4 (`EXT-X-MAP`) → init + segmentos concatenados; nome `<título> - <rótulo>.mp4` sanitizado.
- Recusas explícitas: criptografado (`ENCRYPTED`), ao vivo (`LIVE`), acima de 1,5 GiB (`TOO_LARGE`), codec não suportado (`UNSUPPORTED_CODEC`).
- Popup: botão Baixar habilitado para HLS válido, barra de progresso (`download-progress`, com `aria-valuenow`), botão cancelar (`cancel-download`), estados de erro.

**Não-objetivos (fora do escopo):**
- Criptografia (AES-128/SAMPLE-AES) e DRM — nunca; ao vivo; DASH; legendas e áudios alternativos; gravação em disco por streaming (arquivos acima do limite são recusados).

## 3. Dependências
- **Implementações necessárias:** SPEC-0011 — `HlsInfo`, `resolveHls`, candidatos HLS resolvidos, seletor de qualidade, fixtures HLS.
- **Contratos consumidos:** N/A
- **Pré-requisitos externos:** `mux.js` 6.3.0 (Apache-2.0) instalado com versão fixa.

## 4. Decisão Arquitetural
**Contexto:** ADR-0013 (montagem no offscreen; limites; recusas), ADR-0012, ADR-0008, ADR-0006, ADR-0001.

**Decisão:** lógica pura em `src/core/hls-download` (agendador, progresso, estado de jobs, nome do arquivo, escolha de montagem) com portas para `fetch`, relógio e montador; `mux.js` e `URL.createObjectURL` apenas em `entrypoints/offscreen`; o background orquestra jobs e fala com o offscreen por `runtime.sendMessage` (alvo `offscreen`); estado dos jobs em `storage.session` para sobreviver à suspensão do service worker.

**Justificativa:** respeita ADR-0001 (core sem APIs do navegador) e as limitações do MV3 (service worker sem DOM; offscreen com só `runtime`).

**Desvio do padrão existente:** nova permissão `offscreen` e novo entrypoint; uso de blob URL do offscreen em `chrome.downloads` (não documentado oficialmente — provado no Chromium real por E2E-01).

**Alternativas descartadas:** `.ts` concatenado (ADR-0013 B); ffmpeg.wasm (C); montar no service worker (sem DOM, efêmero).

**ADRs:** ADR-0013, ADR-0012, ADR-0008, ADR-0006, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** progresso atualizado ao menos 2 vezes por segundo; cancelamento interrompe novas requisições em < 1 s; vídeo de fixture (~6 s, 2 qualidades) baixa e monta em < 10 s no CI — medido em E2E-01/E2E-02.
- **Segurança:** só segmentos listados na playlist resolvida (`http(s)`), nenhuma URL do conteúdo além das da playlist; recusa criptografado e ao vivo no servidor, não só na UI; limite de 1,5 GiB — IT-03.
- **Privacidade e dados pessoais:** requisições apenas às URLs de playlist/segmento do próprio vídeo; logs e erros sem query; blob URL revogada ao concluir ou cancelar — IT-05.
- **Disponibilidade e resiliência:** retentativas; falha definitiva de um segmento encerra o job com erro claro sem arquivo parcial; job sobrevive à suspensão do service worker (estado em `storage.session`) — UT-01, UT-04, IT-02.
- **Acessibilidade (UI):** progresso com `role="progressbar"`, botão cancelar acessível por teclado, axe sem violações — E2E-01.
- **Custo:** N/A.

## 6. Artefato A — Contrato
**Interface:** mensagens `download` (HLS), `job`, `cancel` · `JobState` · agendador · montador · offscreen · popup

```ts
// {type:'download', candidateId, variantIndex?} — para candidatos hls (variantIndex padrão = 0, a maior)
{ ok:true, jobId: string }
| { ok:false, error:'CANDIDATE_NOT_FOUND' | 'HLS_NOT_RESOLVED' | 'ENCRYPTED' | 'LIVE' | 'JOB_ALREADY_RUNNING' | 'TOO_MANY_JOBS' }
// {type:'job', jobId} → { ok:true, job: JobState } | { ok:false, error:'JOB_NOT_FOUND' }
// {type:'cancel', jobId} → { ok:true } | { ok:false, error:'JOB_NOT_FOUND' }

interface JobState {
  jobId: string; candidateId: string; variantIndex: number;
  state: 'queued' | 'running' | 'assembling' | 'saving' | 'done' | 'error' | 'canceled';
  segmentsDone: number; segmentsTotal: number; bytesDone: number;
  percent: number;                                   // 0–100; segmentos concluídos / total (monotônico)
  filename?: string; downloadId?: number;
  error?: 'FETCH_FAILED' | 'TOO_LARGE' | 'UNSUPPORTED_CODEC' | 'ASSEMBLY_FAILED' | 'DOWNLOAD_FAILED' | 'ENCRYPTED' | 'LIVE';
}

// Agendador (core): runSegments({ urls, concurrency: 4, retries: 3, backoffMs: (n) => 250 * 2**n, fetch, sleep, signal, onProgress })
//   → Uint8Array[] na ordem original; falha definitiva de um segmento rejeita e aborta os demais; signal.abort cancela.
// Montagem (offscreen): assembleTs(init?, segments) via mux.js → MP4 (ftyp+moov+mdat); assembleFmp4(init, segments) → concatenação;
//   total bufferizado > 1,5 GiB → TOO_LARGE; mux sem trilha de vídeo/áudio H.264/AAC → UNSUPPORTED_CODEC
// Offscreen: documento 'offscreen.html' (razão BLOBS); mensagens {target:'offscreen', type:'start'|'cancel', ...}; devolve blob URL ao background
// Background: downloads.download({ url: blobUrl, filename }) → ao concluir (downloads.onChanged complete) ou cancelar, revoga a blob URL e fecha o offscreen se não houver outros jobs
// Nome: toFilename({ title, label }) → '<título> - <rótulo>.mp4' (sanitização da SPEC-0005)
// Popup (data-testid): download-button (habilitado para HLS resolvido, sem criptografia, VOD), download-progress, cancel-download, job-error
```

**Design:** ao clicar em Baixar, o botão vira barra de progresso com percentual e segmentos (`12 de 30`), o botão **Cancelar** ao lado; ao concluir mostra "Salvo como <nome>.mp4"; em erro, a mensagem traduzida do `error` e o botão de tentar novamente.

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| HLS VOD sem criptografia (TS) | master 2 qualidades, escolher a maior | arquivo `.mp4` válido com a duração da fixture | E2E-01, IT-01, UT-05 |
| Escolher outra qualidade | `variantIndex` 1 | baixa a variante escolhida, rótulo no nome | IT-02, UT-03 |
| HLS fMP4 (`EXT-X-MAP`) | playlist com init | concatena init + segmentos | UT-05, IT-01 |
| Progresso | segmentos concluídos fora de ordem | `percent` monotônico, `segmentsDone` correto | UT-02 |
| Retentativa | segmento falha 2 vezes e depois responde | job conclui | UT-01 |
| Falha definitiva | segmento falha 4 vezes | job `error` `FETCH_FAILED`, sem arquivo | UT-01, IT-02 |
| Cancelamento | cancelar durante o download | requisições param, estado `canceled`, blob revogada | UT-04, IT-04, E2E-02 |
| Criptografado | `hls.encrypted` | `ENCRYPTED`, sem job | IT-03, E2E-03 |
| Ao vivo | `hls.live` | `LIVE`, sem job | IT-03 |
| Grande demais | total > 1,5 GiB | `TOO_LARGE` antes de montar tudo | UT-04, IT-03 |
| Codec não suportado | segmento sem H.264/AAC | `UNSUPPORTED_CODEC` | UT-05 |
| Job duplicado / excesso | 2º job do mesmo candidato; 3 jobs simultâneos | `JOB_ALREADY_RUNNING` / `TOO_MANY_JOBS` | IT-02 |
| Suspensão do service worker | novo background com o mesmo `storage.session` | `job` continua respondendo o estado | IT-02 |
| Privacidade | URLs com `?token=` | logs sem query; só playlist/segmentos requisitados | IT-05 |
| Contrato de jobs | `JobState` | validador aceita estados válidos; rejeita `percent` fora de 0–100 | CT-01 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — comportamento novo; os testes de SPEC-0005/0011 guardam o restante.

### 7.2 Testes Unitários
- **UT-01** — Dado um `fetch` fake que falha N vezes por segmento, quando `runSegments` roda com concorrência 4 e 3 retentativas, então a ordem é preservada, a espera segue `250·2ⁿ` ms (relógio injetado) e a falha definitiva rejeita abortando os demais.
- **UT-02** — Dado conclusões de segmentos fora de ordem e tamanhos desconhecidos, quando o cálculo de progresso roda, então `percent` é monotônico e `segmentsDone`/`bytesDone` somam corretamente.
- **UT-03** — Dado título com caracteres proibidos/longo e um rótulo, quando `toFilename` é chamado, então devolve `<título> - <rótulo>.mp4` sanitizado com no máximo 120 caracteres.
- **UT-04** — Dado a máquina de estados de job, quando ocorrem cancelamento no meio, erro definitivo e excesso do limite de 1,5 GiB, então os estados finais são `canceled`, `error` e `error:TOO_LARGE`, sem transições inválidas.
- **UT-05** — Dado segmentos TS reais da fixture, quando `assembleTs` (mux.js) roda, então o resultado começa com `ftyp`, contém `moov` e `mdat` e tem duração ≈ à da fixture; dado fMP4, a concatenação mantém o init primeiro; dado segmento sem H.264/AAC, falha com `UNSUPPORTED_CODEC`.

### 7.3 Testes de Integração
- **IT-01** — Com o servidor de fixtures real e o montador real (Node), baixar o HLS TS e o fMP4 produz MP4 válido (caixas `ftyp/moov/mdat` e duração).
- **IT-02** — Com o background real, `fakeBrowser` e um offscreen simulado, `download` cria o job, `job` mostra progresso até `done` e `downloads.download` recebe a blob URL e o nome esperado; 2º job do mesmo candidato → `JOB_ALREADY_RUNNING`, 3 simultâneos → `TOO_MANY_JOBS`; falha definitiva → `error: FETCH_FAILED`; recriar o background preserva o estado do job.
- **IT-03** — Com o background real, `download` de candidato `encrypted` → `ENCRYPTED`, `live` → `LIVE`, e nenhuma requisição de segmento é feita; total declarado > 1,5 GiB → `TOO_LARGE`.
- **IT-04** — Cancelar durante o download interrompe novas requisições ao servidor de fixtures em < 1 s e revoga a blob URL.
- **IT-05** — Com o logger real, o diagnóstico de um job com URLs `?token=...` não contém `token=`; o servidor de fixtures só recebeu playlists e segmentos do vídeo.

### 7.4 Testes de Contrato
- **CT-01** — Contrato `JobState` e das mensagens `download/job/cancel` (usado pelo popup): o validador aceita estados e erros válidos e rejeita `percent` fora de 0–100, `state` desconhecido e `error` fora do conjunto.

### 7.5 Testes E2E
- **E2E-01** — Numa página que carrega o HLS de fixture (2 qualidades), o usuário escolhe a qualidade, clica em Baixar, vê a barra de progresso chegar a 100% e o arquivo `.mp4` salvo é válido (caixas `ftyp/moov/mdat`, duração ≈ fixture); builds `local` e `public` [jornada: baixar-hls].
- **E2E-02** — O usuário cancela um download em andamento (servidor de fixtures com atraso por segmento): o progresso para, aparece "cancelado" e nenhum arquivo é salvo.
- **E2E-03** — Com HLS criptografado (fixture com `AES-128`), o popup mostra `badge-encrypted` e nenhum botão de download; nenhuma requisição de segmento sai.

### 7.6 Outros
- Verificação manual no G6: baixar um HLS real sem criptografia no build `local` e abrir o `.mp4` em um player (registrar o site, a qualidade e o resultado); tentar um HLS com criptografia e conferir o selo.
- Acessibilidade: axe no popup durante o download (E2E-01).
- Desempenho: tempo de montagem de 200 MB sintéticos medido em IT-01 (informativo, sem limite).

**Dublês e dados de teste:** fixtures HLS pequenas geradas de forma reprodutível com ffmpeg (`e2e/fixtures/hls/`: ~6 s, 2 qualidades, TS e fMP4, versionadas) e servidor com atraso configurável por segmento; fake `browser.*`/`offscreen`; relógio injetável.

**Ambiente de execução:** Vitest (Node) e Playwright com a extensão carregada, local e CI.

## 8. Plano de Rollout
- **Estratégia:** deploy direto numa release rc; sem feature flag (recusas por segurança já limitam o risco).
- **Dados/schema:** estado de jobs em `storage.session` (efêmero).
- **Compatibilidade:** mensagens aditivas; permissão nova `offscreen` (sem aviso de instalação adicional relevante).
- **Observabilidade:** contadores locais de jobs concluídos/cancelados/falhos por motivo; ID de correlação por job; botão "Copiar diagnóstico".
- **Rollback:** versão anterior pela pipeline de release.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
- [x] Formato de saída do HLS — MP4 reproduzível via mux.js (Thomas aprovou "seguir o recomendado", 2026-10-02; ADR-0013)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Núcleo do download**
- [ ] Red: escrever UT-01, UT-02, UT-03, UT-04, CT-01 com a tag `SPEC-0012:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (agendador, progresso, estados de job, nome do arquivo)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Montagem e offscreen**
- [ ] Red: escrever UT-05, IT-01, IT-03, IT-04 com a tag `SPEC-0012:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (mux.js 6.3.0 no offscreen, blob URL, limites)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Jobs no background**
- [ ] Red: escrever IT-02, IT-05 com a tag `SPEC-0012:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (download/job/cancel, storage.session)
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 4: Jornada E2E**
- [ ] Red: escrever E2E-01, E2E-02, E2E-03 com a tag `SPEC-0012:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados (popup com progresso e cancelamento)
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
| G1 Red | PENDING | | |
| G2 Green | PENDING | | |
| G3 Arquitetura | PENDING | | |
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
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0012`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
| 1 (dependência) | 2026-10-02 | `depends_on: [SPEC-0011]` passa a `consumes_contract: [SPEC-0011@1]` | a dependência real é o código/contrato já integrado na `main` (SPEC-0011 com G5 e H2); o fechamento (G6 manual e G7) das specs do épico acontece em lote numa única rc no fim, pois a verificação manual exige o Thomas | SPEC-0011 (sem efeito no contrato) | thomas (delegação no chat, 2026-10-02: seguir o recomendado) |
