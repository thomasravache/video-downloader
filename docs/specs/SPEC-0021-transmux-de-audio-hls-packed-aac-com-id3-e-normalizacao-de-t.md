---
id: SPEC-0021
title: Transmux de audio HLS packed AAC com ID3 e normalizacao de track_id
tier: full
type: fix
user_facing: true
status: in-progress
created: 2026-10-07
parent:
depends_on: [SPEC-0020]
consumes_contract: [SPEC-0014@1, SPEC-0018@1, SPEC-0019@1, SPEC-0020@1]
contract_version: 1
touches:
  - entrypoints/offscreen/assemble.ts
  - entrypoints/offscreen/run-job.ts
  - tests/unit/**
  - tests/integration/**
  - e2e/journeys/**
  - e2e/fixtures/**
adrs: [ADR-0014, ADR-0013, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-07
---

# SPEC-0021 — Transmux de áudio HLS packed AAC com ID3 e normalização de track_id

## 1. Visão Geral
Esta especificação resolve a causa raiz identificada após o teste da versão `v0.1.0-rc.7`, onde o download de vídeos do YouTube em 1080p H.264 abriu no QuickTime Player com vídeo perfeito de 409.99s (9830 frames), mas a **trilha de áudio foi truncada aos 5.73 segundos** (apenas 247 frames / 1 segmento de áudio), enquanto a extensão concorrente baixou a trilha de áudio completa com 17657 quadros (409.99s).

A investigação detalhada revelou:
1. No YouTube HLS, as faixas de áudio AAC (ex: itags 234 e 233) são entregues em segmentos de Elementary Stream / Packed Audio com tags ID3 contendo carimbos de tempo (`com.apple.streaming.transportStreamTimestamp` - RFC 8216 §3.4) e cabeçalhos de sincronia ADTS (`0xFFF1`).
2. Em `entrypoints/offscreen/run-job.ts`, o pipeline verificava apenas se o primeiro byte do segmento de áudio era `0x47` (`const isTs = audioSegments[0]?.[0] === 0x47`). Como os segmentos do YouTube começam com a assinatura ID3 (`0x49 0x44 0x33`), a checagem avaliava como `false` e o áudio caiu na concatenação bruta em `new Blob(audioSegments)`.
3. Ao abrir esse Blob concatenado, o demuxer do Mediabunny leu os pacotes do primeiro segmento (247 pacotes = 5.735s) e, ao encontrar a tag ID3 do segundo segmento, encerrou a leitura, descartando todos os 70 segmentos restantes.
4. Além disso, quando o `muxjs.mp4.Transmuxer` (ADR-0013) processa Elementary Stream de áudio ADTS/ID3, ele gera caixas com `track_id = 0`, o que viola a norma ISO/IEC 14496-12 (onde `track_id` não pode ser 0), quebrando a conformidade do contêiner MP4 e gerando erros em reprodutores nativos se não normalizado.

Esta spec corrige a identificação de segmentos de áudio que exigem transmuxing, integra os segmentos packed AAC com o `transmuxTsToFmp4` e normaliza caixas com `track_id = 0` para `track_id = 1`, garantindo que 100% da duração e dos frames de áudio sejam incluídos no arquivo final.

## 2. Motivação & Escopo
**Motivação:** Na versão `v0.1.0-rc.7`, o vídeo baixado pelo usuário (`(17) VOCÊ PRECISA DESCANSAR (LENDO LIVROS) - YouTube - 1080p (H.264).mp4`) ficou com o áudio cortado logo nos primeiros segundos. A comparação com o vídeo de referência da extensão concorrente (`VOCÊ PRECISA DESCANSAR LENDO LIVROS.mp4`) comprovou que o áudio deveria durar 409.99s (17657 frames AAC), e não 5.73s (247 frames).

**Objetivos (dentro do escopo):**
- Reconhecer segmentos de áudio packed AAC (com cabeçalho ID3 ou syncword ADTS) além de MPEG-TS padrão (`0x47`) em `entrypoints/offscreen/run-job.ts`.
- Transmuxar toda a cadeia de segmentos de áudio através de `transmuxTsToFmp4` antes de entregar o `audioBlob` para o montador do Mediabunny (`assembleMerged`).
- Normalizar o `track_id` gerado pelo `muxjs.mp4.Transmuxer` em `assemble.ts`: se `track_id === 0`, atualizar para `track_id = 1` nas caixas `tkhd` e `trex` do `initSegment` e nas caixas `tfhd` dos fragmentos fMP4.
- Garantir que `assembleMerged` receba um stream contínuo fMP4 de áudio com a duração integral de todos os segmentos e todas as amostras AAC decodificáveis.

**Não-objetivos (fora do escopo):**
- Reencodificação de áudio ou vídeo (mantém transmuxing sem perda e sem recompressão).
- Alterações em DRM Widevine (rejeitado por ADR-0001).

## 3. Dependências
- **Implementações necessárias:** SPEC-0020 (transmuxer fMP4 contínuo e merge offscreen).
- **Contratos consumidos:** SPEC-0014@1, SPEC-0018@1, SPEC-0019@1, SPEC-0020@1.
- **Pré-requisitos externos:** mux.js v7.1.0 e mediabunny v1.61.0 (já instalados).

## 4. Decisão Arquitetural
**Contexto:** O pipeline offscreen do projeto (`entrypoints/offscreen/run-job.ts` e `assemble.ts`) processa vídeo e áudio separados via Mediabunny e mux.js (ADR-0014, ADR-0013). Para vídeo MPEG-TS, o transmuxer já gera fragmentos fMP4 contínuos alinhados por `alignFragmentTimestamps`. Para áudio, a detecção de formato foi incompleta e o tratamento de `track_id = 0` emitido pelo mux.js em fluxos de áudio elementares não estava presente.

**Decisão:**
1. Em `entrypoints/offscreen/assemble.ts`:
   - Criar `normalizeTrackId(initSegment: Uint8Array, fragments: Uint8Array[]): { initSegment: Uint8Array; fragments: Uint8Array[] }`: se o `track_id` em `tkhd` for 0, ajusta para 1 em `tkhd` e `trex` do `initSegment`, e em `tfhd` de cada fragmento.
   - Integrar `normalizeTrackId` na saída de `transmuxTsToFmp4`.
2. Em `entrypoints/offscreen/run-job.ts`:
   - Atualizar a detecção de áudio separado que necessita de transmuxing: se `audio.initUrl === undefined`, verificar se os segmentos são MPEG-TS (`0x47`), packed AAC ID3 (`0x49 0x44 0x33`) ou ADTS (`0xFF 0xF0`), acionando `transmuxTsToFmp4(audioSegments)`.
   - Se `audio.initUrl !== undefined`, mas os bytes baixados não correspondem a caixas MP4 (`ftyp` ou `moov`), tratar como mídia que requer transmuxing em vez de concatenação cega.
3. Compatibilidade:
   - Preservar alinhamento de timestamps entre vídeo e áudio gerado pelo Mediabunny.

**Justificativa:** Corrige a causa raiz física comprovada sem introduzir novas bibliotecas nem alterar a arquitetura dos ADRs existentes (ADR-0014, ADR-0013).

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:**
- Tentar decodificar e reencodar AAC no Web Audio API: descartado por perda de qualidade, alto uso de CPU e dependência desnecessária. O `mux.js` já empacota AAC perfeitamente em caixas `mp4a` quando o `track_id` é normalizado.

**ADRs:** ADR-0014, ADR-0013, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** O transmuxing de 71 segmentos de áudio packed AAC leva menos de 200ms no navegador, consumindo pouca memória.
- **Segurança:** Isolamento mantido no documento offscreen sem execução de scripts externos.
- **Privacidade e dados pessoais:** Sanitização de URLs sensíveis preservada conforme ADR-0006.
- **Disponibilidade e resiliência:** Suporta tanto MPEG-TS quanto packed AAC ID3 e ADTS nativo sem falhas.
- **Acessibilidade (UI):** N/A — sem alterações na interface gráfica.
- **Custo:** N/A — processamento 100% no cliente.

## 6. Artefato A — Contrato
**Interface:** `entrypoints/offscreen/assemble.ts`, `entrypoints/offscreen/run-job.ts`

```typescript
// Em entrypoints/offscreen/assemble.ts:
export function normalizeTrackId(
  initSegment: Uint8Array,
  fragments: Uint8Array[],
): { initSegment: Uint8Array; fragments: Uint8Array[] };

export function transmuxTsToFmp4(
  segments: readonly Uint8Array[],
): Promise<{ initSegment: Uint8Array; fragments: Uint8Array[] }>;

// Em entrypoints/offscreen/run-job.ts:
// Detecção de áudio que precisa de transmuxing (MPEG-TS, ID3 packed AAC, ADTS):
function needsAudioTransmux(segments: readonly Uint8Array[]): boolean;
```

**Design:** N/A — sem interface.

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Transmux de áudio ID3 + ADTS multi-segmento | Segmentos de áudio iniciados com ID3 (`0x49 0x44 0x33`) ou ADTS (`0xFFF1`) | fMP4 contínuo com todos os segmentos, duração total somada e `track_id = 1` | UT-01, IT-01, CT-01 |
| Normalização de track_id em assemble.ts | `initSegment` e `fragments` gerados com `track_id: 0` | `tkhd`, `trex` e `tfhd` atualizados para `track_id: 1` | UT-01, CT-01 |
| Seleção de transmux no run-job | Áudio separado sem initUrl contendo segmentos ID3/ADTS | Executa `transmuxTsToFmp4` e entrega Blob fMP4 com duração completa ao Mediabunny | UT-02, IT-01 |
| E2E download de vídeo YouTube com áudio contínuo | Vídeo 1080p H.264 do YouTube baixado | Arquivo MP4 final gerado contendo vídeo e áudio sincronizados até o fim | E2E-01 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
- **CH-01** — Transmux de vídeo MPEG-TS e áudio da SPEC-0020 continua gerando MP4 válido e passando. (guarda: passa antes da mudança)

### 7.2 Testes Unitários
- **UT-01** — `transmuxTsToFmp4` aceita múltiplos segmentos de áudio packed AAC com ID3 e ADTS, gera fMP4 contínuo com todos os pacotes dos segmentos e normaliza `track_id: 0` para `track_id: 1` em `tkhd`, `trex` e `tfhd`. Tag: `SPEC-0021:UT-01`
- **UT-02** — `run-job.ts` reconhece segmentos de áudio iniciados com `ID3` ou `ADTS` (sem init fMP4) e executa o transmuxing para fMP4 antes de entregar ao `assembleMerged`, gerando áudio com a duração total multi-segmento. Tag: `SPEC-0021:UT-02`

### 7.3 Testes de Integração
- **IT-01** — Pipeline offscreen completo com vídeo TS e múltiplos segmentos de áudio packed AAC ID3 (simulando YouTube itag 234) entrega arquivo MP4 contendo trilha de áudio completa com a soma das durações de todos os segmentos. Tag: `SPEC-0021:IT-01`

### 7.4 Testes de Contrato
- **CT-01** — Contrato do `transmuxTsToFmp4` garante compatibilidade de saída com `assembleMerged` do Mediabunny para áudio e vídeo sem emitir `track_id: 0`. Tag: `SPEC-0021:CT-01`

### 7.5 Testes E2E
- **E2E-01** — [jornada: baixar-hls] Valida download de vídeo HLS com áudio packed AAC gerando arquivo com trilha de áudio contínua e duração correspondente à do vídeo. Tag: `SPEC-0021:E2E-01`

### 7.6 Outros
N/A

**Dublês e dados de teste:** Fixtures de segmentos de áudio ID3+ADTS baseadas em amostras reais capturadas do YouTube.

**Ambiente de execução:** vitest e playwright em ambiente local e CI.

## 8. Plano de Rollout
- **Estratégia:** Deploy direto no branch principal através de release patch/minor (v0.1.0-rc.8).
- **Dados/schema:** N/A.
- **Compatibilidade:** Totalmente compatível com fluxos existentes de HLS TS e fMP4.
- **Observabilidade:** Logs offscreen registram duração e contagem de segmentos processados no job.
- **Rollback:** Reversão do commit de merge via Git caso necessário.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
Nenhuma

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
- [x] Fase 0: Teste de caracterização CH-01 commitado passando.
- [x] Fase 1: Escrever testes Red (UT-01, UT-02, IT-01, CT-01, E2E-01) com a tag `SPEC-0021:<ID>` e confirmar falha esperada (G1 Red).
- [x] Fase 2: Implementar `normalizeTrackId` em `assemble.ts` para normalizar `track_id: 0` para `track_id: 1` nas caixas `tkhd`, `trex` e `tfhd`.
- [x] Fase 3: Implementar detecção de áudio packed AAC (ID3 `0x49 0x44 0x33` e ADTS `0xFFF1`) em `run-job.ts` acionando `transmuxTsToFmp4` para áudio multi-segmento.
- [x] Fase 4: Executar suíte completa de testes unitários, integração e E2E até Green (G2), validar arquitetura (G3) e conduzir code review independente (G4).

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 46799cd (árvore suja) | 2026-10-07 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯) — d0ac475 | 2026-10-07 |
| G2 Green | PASS | build exit 0 (✔ Finished in 385 ms); test exit 0 (Duration  65.75s (tests 97%, import 2%, transform 1%)); lint exit 0 (✔ Finished in 178 ms); coverage exit 0 (================================================================================) — c8403df | 2026-10-08 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (64 modules, 139 dependencies cruised)) — 71f2ecc | 2026-10-08 |
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
- [ ] Pendências registradas como novas specs (ou nenhuma)

### Deploy

### Pendências

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
