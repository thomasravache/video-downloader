---
id: SPEC-0018
title: Corrigir transmuxer HLS TS com MP4 compativel, ignorar legendas e enriquecer titulo
tier: full
type: fix
user_facing: true
status: in-progress
created: 2026-10-06
parent:
depends_on: []
consumes_contract: [SPEC-0011@1, SPEC-0012@1, SPEC-0014@1, SPEC-0016@1, SPEC-0017@1]
contract_version: 1
touches:
  - entrypoints/offscreen/**
  - src/core/**
  - entrypoints/background/**
  - entrypoints/popup/**
  - tests/unit/**
  - tests/integration/**
  - e2e/journeys/**
  - tools/sdd/**
adrs: [ADR-0013, ADR-0014]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-06
---

# SPEC-0018 — Corrigir transmuxer HLS TS com MP4 compativel, ignorar legendas e enriquecer titulo

## 1. Visão Geral
Esta spec corrige três defeitos observados em ambiente de produção (testes reais em aulas do Hotmart Club) durante a release v0.1.0-rc.4:
1. **Transmuxing HLS TS incompatível no QuickTime / macOS:** O transmuxer `assembleTs` gerava um fMP4 bruto com `duration: 0xffffffff` no `moov` e `trun` em versão 0 contendo offsets de composição negativos (`sample.compositionTimeOffset < 0`), fazendo com que players nativos (QuickTime / AVFoundation do macOS) interpretassem a duração como 27h 03m 18s e travassem a reprodução após os primeiros 6 segundos, apesar de todos os segmentos terem sido baixados e descriptografados perfeitamente (arquivo de 26.7 MB).
2. **Playlists de legendas (subtitles) capturadas como vídeo:** O sniffer de rede capturava playlists `.m3u8` de legendas WebVTT (`TYPE=SUBTITLES` / `textstream`), gerando cartões no popup que falhavam com erro "This video uses an audio or video format that is not supported yet." no topo da lista.
3. **Título do arquivo HLS baixado:** Candidatos HLS capturados da rede recebiam nome de arquivo cru da URL (ex.: `master-pkg-t-1776783917000.m3u8 - 1080p.mp4`) por falta de associação com o título da página/aba (`document.title` / `tab.title`).

A correção garante que:
- O transmuxing de MPEG-TS no offscreen finalize o arquivo através do `mediabunny` (já autorizado no offscreen pela ADR-0014), gerando um MP4 progressivo padronizado com `fastStart` e tabela de amostras completa no `moov`, com duração real exata (ex.: 01:44) e compatibilidade total em qualquer player de desktop ou mobile.
- Caixas `trun` com offsets de composição negativos sejam tratadas ou normalizadas em versão 1 antes do empacotamento, prevenindo estouro de 32 bits.
- Playlists de legendas (`TYPE=SUBTITLES` ou contendo segmentos `.webvtt`/`.vtt`) sejam descartadas de candidatos de vídeo.
- Candidatos de rede HLS associem o título da aba ativa no momento da detecção/captura, produzindo arquivos com nomes legíveis (ex.: `alves.instrutorpilotagem angelo Hotmart Club.mp4`).

## 2. Motivação & Escopo
**Motivação:** Na validação prática da release `v0.1.0-rc.4` na Hotmart, o usuário comparou nossa extensão com uma extensão concorrente. Embora o download de 26.7 MB tenha sido bem-sucedido via AES-128 e contexto de requisição, o arquivo MP4 não era funcional no player padrão do macOS (parava aos 6 segundos) e o popup exibia cartões espúrios de legendas e nomes de arquivo indecifráveis. A correção restabelece paridade competitiva e entrega uma experiência de usuário impecável.

**Objetivos (dentro do escopo):**
- Corrigir `assembleTs` em `entrypoints/offscreen/assemble.ts` para produzir um MP4 progressivo padrão compatível via `mediabunny`, com duração exata e tabela de amostras no `moov`.
- Ajustar a leitura/emissão de caixas `trun` com offsets de composição negativos para evitar o estouro de `uint32` (de 47.721 segundos / 13h) em parsers e no `mediabunny`.
- Descartar playlists HLS cujo tipo seja comprovadamente legendas (`subtitles`, `.webvtt`, `textstream`) no sniffer de rede e na resolução HLS, impedindo cartões com erro no popup.
- Enriquecer candidatos capturados de rede com o título da aba (`tab.title`), garantindo nomes de arquivo coerentes no download.

**Não-objetivos (fora do escopo):**
- Download ou extração isolada de legendas em formato `.srt`/`.vtt` (futura funcionalidade).
- Mudança na arquitetura de workers ou substituição do `mux.js` para demuxing de MPEG-TS elementar (o `mux.js` continua demuxando TS no offscreen, conforme ADR-0013).

## 3. Dependências
- **Implementações necessárias:** SPEC-0012 (Download HLS), SPEC-0014 (Merge AV com mediabunny), SPEC-0016 (Contexto de requisição), SPEC-0017 (AES-128 local) — todas implementadas na branch `main`.
- **Contratos consumidos:** SPEC-0011@1, SPEC-0012@1, SPEC-0014@1, SPEC-0016@1, SPEC-0017@1.
- **Pré-requisitos externos:** Bibliotecas já instaladas `mux.js` e `mediabunny` no offscreen. Nenhuma dependência externa nova.

## 4. Decisão Arquitetural
**Contexto:** Conforme ADR-0013 e ADR-0014, tanto `mux.js` quanto `mediabunny` são restritos estritamente ao `entrypoints/offscreen/**`. Na SPEC-0014, `assembleMerged` provou que `mediabunny` gera MP4s progressivos (`fastStart: 'in-memory'`) de altíssima fidelidade e compatibilidade universal, testados com `ffprobe` e `AVFoundation`.

**Decisão:**
1. Em `entrypoints/offscreen/assemble.ts`, após o transmuxer `mux.js` converter os segmentos TS em fMP4 intermediário:
   - Sanitizar a versão das caixas `trun` para versão 1 quando houver offsets de composição negativos (prevenindo que parsers leiam -6000 como 4294961296 ticks).
   - Passar o stream fMP4 pelo `mediabunny` gerando o MP4 final em contêiner progressivo padrão (`Mp4OutputFormat({ fastStart: 'in-memory' })`).
   - Caso `mediabunny` não seja necessário (ex.: clipe puramente de vídeo sem áudio ou sem suporte específico), manter fallback robusto com `moov` contendo durações corrigidas.
2. Em `src/core/network.ts` e `src/core/hls/parse.ts`:
   - No `classifyNetworkResponse`, descartar requisições com tipo `text/vtt` ou extensões `.vtt`/`.webvtt` ou padrões conhecidos de trilha de texto isolada (`textstream`, `subtitles`).
   - No `parseHlsPlaylist`, caso uma playlist de mídia declare segmentos exclusivamente `.webvtt`/`.vtt`, identificá-la como `type: 'subtitles'` e recusar resolução como candidato de vídeo.
3. Em `entrypoints/background/network.ts` / `src/core/service.ts`:
   - Obter o título da aba (`tab.title`) ao salvar o candidato de rede no `deps.network.add`, associando `title: tab.title`.

**Justificativa:** Resolve a causa raiz física no container de mídia sem introduzir novas bibliotecas, respeitando 100% as regras de dependências e boundaries arquiteturais.

**Desvio do padrão existente:** Nenhum. Utiliza as bibliotecas e portas já existentes.

**Alternativas descartadas:**
- *Deixar fMP4 cru:* Rejeitado porque o QuickTime Player e o AVFoundation no macOS não suportam arquivos locais fMP4 sem tabela central de amostras, causando a falha relatada de 6 segundos.
- *Adicionar ffmpeg.wasm:* Rejeitado por ser desnecessário, lento e pesar mais de 25 MB no pacote da extensão, violando ADR-0014.

**ADRs:** ADR-0013 (mux.js isolado no offscreen), ADR-0014 (mediabunny no offscreen).

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** O remux com `mediabunny` em memória para um vídeo de 104s (26.7 MB) executa em menos de 100ms no offscreen sem travamento de UI.
- **Segurança:** O isolamento de processos permanece inalterado; `mediabunny` e `mux.js` operam isolados no documento offscreen sem acesso a DOM privilegiado.
- **Privacidade e dados pessoais:** Títulos de abas são usados estritamente para o nome do arquivo gerado localmente no download do usuário, sem envio para servidores externos.
- **Disponibilidade e resiliência:** Se a entrada TS for degenerada ou não contiver trilhas válidas, `AssemblyError('UNSUPPORTED_CODEC')` é retornado como previsto em SPEC-0012.
- **Acessibilidade (UI):** Nenhuma alteração de acessibilidade no popup.
- **Custo:** N/A — execução 100% local no cliente.

## 6. Artefato A — Contrato
**Interface:** `assembleTs(init: Uint8Array | undefined, segments: readonly Uint8Array[]): Promise<Uint8Array>` em `entrypoints/offscreen/assemble.ts`.

A assinatura permanece idêntica à de SPEC-0012, mas a saída gerada passa a ser um arquivo MP4 progressivo padronizado (`ftyp` + `moov` com amostras indexadas + `mdat`), com duração e timestamps precisos e compatíveis com `AVFoundation` e `ffprobe`.

```typescript
export function assembleTs(
  init: Uint8Array | undefined,
  segments: readonly Uint8Array[],
): Promise<Uint8Array>;
```

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Transmux TS com B-frames | Segmentos TS contendo frames com DTS > PTS (offsets negativos de composição) | MP4 gerado com `trun v1` e finalizado via `mediabunny` como MP4 progressivo com duração correta e sem salto de timestamps | UT-01, IT-01, E2E-01 |
| Transmux TS longo com múltiplos segmentos | Múltiplos segmentos TS totalizando > 100s | MP4 gerado reproduz integralmente no AVFoundation/QuickTime, duração calculada bate com a soma dos segmentos (sem duração de 27h) | UT-02, IT-02 |
| Playlist de legendas WebVTT na rede | Resposta de rede para playlist com segmentos `.webvtt` ou `textstream` | `classifyNetworkResponse` descarta ou `resolveHls` rejeita como `NOT_A_VIDEO`, não gerando cartão de vídeo com erro no popup | UT-03, UT-04, IT-03 |
| Candidato HLS de rede recebe título | Evento de rede associado a uma aba com título | Candidato salvo no `NetworkStore` recebe `title: tab.title`, e o arquivo baixado usa esse título sanitizado | UT-05, IT-04 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
- **CH-01** — (guarda: passa antes da mudança) `assembleTs` com os segmentos do clipe de fixture `v360` gera MP4 válido com ftyp, moov e mdat.

### 7.2 Testes Unitários
- **UT-01** — Dado segmentos TS com B-frames e composition time offset negativo, quando `assembleTs` é executado, então o MP4 gerado possui caixas `trun` em versão 1 e é remuxado com sucesso pelo `mediabunny` sem rejeição de timestamps.
- **UT-02** — Dado o arquivo real baixado da Hotmart com anomalia de 27h, quando remuxado com normalização de `trun v1`, então o AVAssetReader / inspetor MP4 lê todas as amostras sem pular para 27 horas.
- **UT-03** — Dado uma resposta de rede com URL contendo `textstream` ou contentType `text/vtt`, quando `classifyNetworkResponse` é chamado, então retorna `null`.
- **UT-04** — Dado uma playlist HLS de mídia cujos segmentos sejam `.webvtt`, quando `parseHlsPlaylist` é chamado, então identifica como playlist de legendas e não de mídia de vídeo.
- **UT-05** — Dado um evento de rede capturado com título de aba disponível, quando o candidato é criado no `onNetworkResponse`, então o candidato contém o título da aba.

### 7.3 Testes de Integração
- **IT-01** — Fluxo completo de montagem de segmentos TS com múltiplos fragmentos e áudio/vídeo combinados: gera MP4 progressivo com metadados de duração exatos e amostras contínuas.
- **IT-02** — Download de candidato HLS com áudio e vídeo em TS: arquivo salvo no download possui nome sanitizado baseado no título da aba e duração conferida.
- **IT-03** — Captura de tráfego de rede contendo master playlist e playlist de legendas: apenas a master e streams de mídia de vídeo/áudio geram candidatos no popup; playlists de legendas são filtradas.
- **IT-04** — Rotação de títulos e fallbacks: se o título da aba for genérico ou vazio, fallback para o nome limpo do arquivo na URL.

### 7.4 Testes de Contrato
- **CT-01** — Verificação de compatibilidade de `assembleTs`: interface e rejeições de erro (`TOO_LARGE`, `UNSUPPORTED_CODEC`) mantêm conformidade com SPEC-0012.

### 7.5 Testes E2E
- **E2E-01** — [jornada: baixar-hls] Usuário abre página com player HLS com TS multiplexado, seleciona a qualidade, inicia download e o arquivo MP4 baixado é íntegro, possui duração esperada e nome formatado com o título da página.

### 7.6 Outros
N/A

**Dublês e dados de teste:** Fixtures de clipe existentes (`e2e/fixtures/hls/clip`), segmentos reais de teste com timestamps de broadcast.

**Ambiente de execução:** Testes unitários no Vitest, testes E2E no Playwright com fixture server.

## 8. Plano de Rollout
- **Estratégia:** Deploy direto no branch `main` integrado à próxima release (`v0.1.0-rc.5`).
- **Dados/schema:** N/A.
- **Compatibilidade:** Totalmente compatível com as versões anteriores; melhora radicalmente a compatibilidade dos MP4s gerados com players de desktop (QuickTime, Windows Media Player) e móveis.
- **Observabilidade:** Logs de diagnóstico já implementados registram `download.started` e `download.done` com duração e bytes montados.
- **Rollback:** Reversão do commit de merge via git caso ocorra regressão.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
Nenhuma.

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação

**Fase 0: Caracterização**
- [ ] CH-01: validar que clipe de fixture `v360` continua montando com sucesso antes de mudanças estruturais

**Fase 1: Transmuxing MP4 progressivo e normalização de timestamps (`entrypoints/offscreen/assemble.ts`)**
- [ ] Red: escrever UT-01 e UT-02 com a tag `SPEC-0018:UT-01` e `SPEC-0018:UT-02` e confirmar que falham pelo motivo esperado
- [ ] Red: escrever IT-01 e CT-01 com tags `SPEC-0018:IT-01` e `SPEC-0018:CT-01`
- [ ] Green: implementar normalização de `trun` em versão 1 e remux progressivo com `mediabunny` (`Mp4OutputFormat({ fastStart: 'in-memory' })`) no `assembleTs`
- [ ] Refactor mantendo testes verdes

**Fase 2: Descarte de playlists de legendas/subtitles (`src/core/network.ts`, `src/core/hls/parse.ts`)**
- [ ] Red: escrever UT-03 e UT-04 com tags `SPEC-0018:UT-03` e `SPEC-0018:UT-04`
- [ ] Red: escrever IT-03 com tag `SPEC-0018:IT-03`
- [ ] Green: descartar `textstream`, `text/vtt` e `.webvtt` no `classifyNetworkResponse` e identificar `type: 'subtitles'` no `parseHlsPlaylist` para ignorar como candidato de vídeo
- [ ] Refactor mantendo tudo verde

**Fase 3: Enriquecimento do título dos candidatos de rede (`entrypoints/background/network.ts`, `src/core/service.ts`)**
- [ ] Red: escrever UT-05, IT-02 e IT-04 com as respectivas tags
- [ ] Green: propagar `tab.title` ao adicionar candidato de rede em `deps.network.add`, associando ao candidato
- [ ] Refactor mantendo tudo verde

**Fase 4: Jornada E2E**
- [ ] Red: E2E-01 falhando pelo motivo esperado
- [ ] Green: jornada de download HLS executando e gerando arquivo com duração correta e nome de arquivo enriquecido

**Fase final: Integração, entrega e documentação**
- [ ] Validar G2 (suíte completa de testes unitários e de integração)
- [ ] Validar G3 (arquitetura `pnpm arch` sem violações)
- [ ] Review independente (G4)
- [ ] Integração e CI verde (G5) e aprovação (H2)
- [ ] Deploy / release rc.5 (G6)
- [ ] Relatório de Entrega, docs e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — a9c4eb8 | 2026-10-06 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯) — 918b443 | 2026-10-06 |
| G2 Green | PASS | build exit 0 (✔ Finished in 278 ms); test exit 0 (Duration  54.97s (tests 97%, import 2%, transform 1%)); lint exit 0 (✔ Finished in 163 ms); coverage exit 0 (================================================================================) — ac8f9c3 | 2026-10-06 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (64 modules, 138 dependencies cruised)) — ce0d8ad | 2026-10-06 |
| G4 Review | PASS | MANUAL: verify G1+G4 PASS; helper tests/integration/support/background.ts ajustou mock tabs.get para refletir tab.title sem alterar lógica de teste | 2026-10-06 |
| G5 Integração & CI | PASS | build exit 0 (✔ Finished in 283 ms); test exit 0 (Duration  53.08s (tests 97%, import 2%, transform 1%)); test_integration exit 0 (at least ~540ms faster with isolate: false — reuses workers across files instead of one pe); test_e2e exit 0 (pnpm exec playwright show-report); arch_test exit 0 (✔ no dependency violations found (64 modules, 138 dependencies cruised)); security_scan exit 0 ([90m12:01AM[0m [32mINF[0m [1mno leaks found[0m) — 5d02712 | 2026-10-07 |
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
