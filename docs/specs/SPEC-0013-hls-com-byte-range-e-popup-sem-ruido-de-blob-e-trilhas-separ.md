---
id: SPEC-0013
title: HLS com faixas de bytes (fMP4 de arquivo único) e popup sem ruído de blob
tier: full
type: feature
user_facing: true
status: proposed
created: 2026-10-02
parent: SPEC-0008
depends_on: []
consumes_contract: [SPEC-0011@1, SPEC-0012@1]
contract_version: 1
touches: [src/core/**, entrypoints/offscreen/**, entrypoints/popup/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**]
adrs: [ADR-0013, ADR-0006, ADR-0001]
external: []
size: M
approved_by:
approved_at:
---

# SPEC-0013 — HLS com faixas de bytes (fMP4 de arquivo único) e popup sem ruído de blob

## 1. Visão Geral
Plataformas de curso servem HLS em que a playlist aponta para **trechos de um único arquivo `.mp4`** (`#EXT-X-BYTERANGE`, e `#EXT-X-MAP` com `BYTERANGE` para o cabeçalho de inicialização). Hoje o download recusa essas playlists (decisão da revisão da SPEC-0012, para não gerar arquivo corrompido) e o popup mostra "Could not read this video's playlist", embora a playlist tenha sido lida. Esta spec faz o download buscar cada trecho com um cabeçalho `Range` e montar o MP4 normalmente, e tira do popup o cartão `blob` ("Not supported yet"), que é só o `<video>` do player usando Media Source e nunca terá o que baixar.

## 2. Motivação & Escopo
**Motivação:** teste manual da rc.2 num site de curso real (2026-10-02): a playlist `…_1080p.m3u8` (VOD, sem `EXT-X-KEY`, `EXT-X-MAP …BYTERANGE="893@0"`, segmentos `len@off` e `len` implícito) falhou no download; o popup também listava um cartão `blob` inútil ao lado das fontes reais.

**Objetivos (dentro do escopo):**
- Baixar HLS sem criptografia cujos segmentos e `EXT-X-MAP` usam `BYTERANGE`, com requisições `Range`, no mesmo fluxo de job, progresso e cancelamento da SPEC-0012.
- Validar rigorosamente a resposta: só `206` com `Content-Range` coerente com o pedido; servidor que ignora `Range` (200) é falha, nunca "segmento".
- Recusar cedo (sem baixar mídia) quando a soma dos trechos excede o limite de 1,5 GiB.
- Esconder do popup o cartão `blob` (`unsupported-stream`) quando houver outra fonte baixável ou HLS na mesma aba; mantê-lo quando for a única coisa detectada.

**Não-objetivos (fora do escopo):**
- Áudio em faixa separada (`#EXT-X-MEDIA TYPE=AUDIO`) e junção de áudio+vídeo: SPEC-0014. Com esta spec isolada, uma playlist de vídeo sem áudio baixa **só o vídeo** (o resultado é o mesmo arquivo que o cartão MP4 direto já oferece).
- Rotular cartões como "só vídeo"/"só áudio" e esconder arquivos diretos redundantes com o HLS: SPEC-0014.
- Criptografia, DRM e playlists ao vivo continuam recusados (ENCRYPTED/PROTECTED/LIVE), com ou sem byte range.
- DASH (`.mpd`), baixar a partir de `blob:`/MSE.

## 3. Dependências
- **Implementações necessárias:** N/A (o código da SPEC-0012 já está na `main`; as specs 0009–0012 seguem `in-progress` só pelo G6 do épico, por isso o vínculo é por contrato).
- **Contratos consumidos:** SPEC-0011@1 (`parseHlsPlaylist`, `HlsInfo`: não muda); SPEC-0012@1 (mensagens `download`/`job`/`cancel`, `JobState`, comando `start` do offscreen: estendido de forma aditiva, ver §6).
- **Pré-requisitos externos:** `ffmpeg` local só para gerar a fixture (já usado em `e2e/fixtures/generate-video.sh`); nenhuma dependência npm nova.

## 4. Decisão Arquitetural
**Contexto:** segue o módulo `src/core/hls-download/*` e o offscreen (`entrypoints/offscreen/{run-job,commands}.ts`) da SPEC-0012 e o ADR-0013 (m3u8-parser só em `src/core`; blobs só no offscreen). O popup filtra a lista no cliente (função pura em `src/core/candidates.ts`, testável sem navegador), como o restante da regra de exibição.

**Decisão:** `parseMediaSegments` passa a devolver, além de `urls`/`initUrl`, as faixas de bytes alinhadas (`ranges`, `initRange`) já com offsets **resolvidos** (offset implícito = fim da faixa anterior do mesmo recurso, RFC 8216 §4.3.2.2). O `start` do offscreen ganha `ranges?` e `initRange?`; o `fetchBytes` envia `Range: bytes=o-(o+l-1)` e valida `206` + `Content-Range`. A recusa de byte range sai do núcleo; toda a validação de segurança (criptografia, live, http(s)) permanece como está.

**Justificativa:** uma só mudança aditiva no contrato interno; o caminho sem byte range fica idêntico (guarda UT-06). O cálculo de offset fica no núcleo, onde é testável e onde já mora o `m3u8-parser`; o offscreen só executa e valida.

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:** (a) baixar o arquivo inteiro uma vez e fatiar: dispensa `Range`, mas ignora a ordem/seleção da playlist e duplica memória; (b) coalescer trechos contíguos em uma requisição grande: menos requisições, mas perde o progresso por segmento e o paralelismo da SPEC-0012 (fica como otimização futura se a latência pesar); (c) esconder o `blob` no extrator: o cartão é correto como diagnóstico quando é a única fonte, então o filtro fica na exibição.

**ADRs:** ADR-0013, ADR-0006, ADR-0001 (nenhum novo).

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** mesmo agendador (concorrência 4, 3 tentativas); download do fixture de 6 s em < 10 s no E2E (como a SPEC-0012). Medir o tempo no E2E-01.
- **Segurança:** resposta sem `206` ou com `Content-Range` diferente do pedido ⇒ falha (IT-02, IT-03); faixas validadas como inteiros seguros positivos (UT-04); byte range não afrouxa nenhuma recusa de criptografia/DRM/live (IT-05).
- **Privacidade e dados pessoais:** as URLs de mídia trazem `token` e `expires` na query; nada disso vai para logs, diagnósticos, erros nem estado do job (IT-06). O `Range` é o único cabeçalho acrescentado.
- **Disponibilidade e resiliência:** falha de rede continua com 3 tentativas e backoff; resposta inválida de `Range` não é repetida indefinidamente (conta como tentativa e falha com `FETCH_FAILED`).
- **Acessibilidade (UI):** nenhum elemento novo; o E2E-01 repete a checagem axe da SPEC-0012.
- **Custo:** N/A — sem serviços pagos.

## 6. Artefato A — Contrato
**Interface:** `parseMediaSegments(text, baseUrl): MediaSegments` (src/core/hls-download/segments.ts); comando `start` do offscreen (src/core/hls-download/protocol.ts); `hideRedundantCandidates(candidates): VideoCandidate[]` (src/core/candidates.ts).

```text
// src/core/hls-download/segments.ts  (aditivo; campos antigos inalterados)
type ByteRange = { offset: number; length: number }   // inteiros seguros; length >= 1; offset >= 0
interface MediaSegments {
  urls: string[]; initUrl?: string; durationSec: number; fmp4: boolean;
  ranges?: (ByteRange | undefined)[]   // mesmo tamanho e ordem de urls; presente só se algum segmento tem BYTERANGE
  initRange?: ByteRange                // BYTERANGE do EXT-X-MAP
}
// Resolução de offset: "len@off" => {offset: off, length: len}.
// "len" sem @ => offset = fim (offset+length) da faixa anterior DO MESMO URL; sem faixa anterior
// no mesmo URL (inclui o 1º segmento ou troca de recurso) => HlsParseError.
// Faixa inválida (NaN, <=0, offset<0, offset+length > Number.MAX_SAFE_INTEGER) => HlsParseError.
// Segmento sem BYTERANGE numa playlist com ranges => ranges[i] === undefined (busca o URL inteiro).

// src/core/hls-download/protocol.ts  — OffscreenStart
{ target:'offscreen', type:'start', jobId, urls, initUrl?, fmp4,
  ranges?: (ByteRange | undefined)[],  // se presente, length === urls.length
  initRange?: ByteRange }              // só com initUrl

// Offscreen fetch com range:
//   request: GET url, header "Range: bytes=<offset>-<offset+length-1>", credentials:'include'
//   aceita: status 206 e Content-Range "bytes <offset>-<end>/<total|*>" igual ao pedido
//   qualquer outro status (inclui 200) ou Content-Range diferente => erro de busca (tentativa);
//   esgotadas as tentativas => JobError FETCH_FAILED.
// Limite: soma(ranges.length) + initRange.length > 1,5 GiB => failed TOO_LARGE antes da 1ª requisição de mídia.

// src/core/candidates.ts
hideRedundantCandidates(list):
  remove candidatos com support==='unsupported-stream' E mediaUrl que não é http(s) (ex.: blob:)
  quando list contém ao menos um OUTRO candidato com support==='downloadable' ou kind==='hls'.
  Caso contrário devolve a lista inalterada. Preserva a ordem. Não muta a entrada.
```

**Design:** N/A — sem tela nova; o popup apenas deixa de renderizar o cartão `blob` nas condições acima. Textos existentes (`errorHlsNotResolved`) não mudam.

**Arquivos/módulos afetados:** ver `touches`. Alterar `segments.ts`, `protocol.ts`, `service.ts` (passar `ranges`/`initRange` ao job), `run-job.ts`, `commands.ts`, `candidates.ts`, `entrypoints/popup/main.ts` (aplicar `hideRedundantCandidates`), `e2e/support/fixture-server.ts` (suporte a `Range`/206), fixture `e2e/fixtures/hls/single-file/**` e página `pages/hls-byterange.html`. Os testes `tests/unit/hls-segments-byterange.test.ts` e o caso de byte range de `tests/integration/hls-job-hardening.test.ts` (que afirmavam a recusa) são **substituídos** por UT-01..05 e IT-01: mudança deliberada de comportamento, não regressão.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Byte range explícito | segmentos `len@off` | `ranges` com offset/length corretos | UT-01 |
| Byte range implícito | `len` sem `@` após faixa do mesmo recurso | offset = fim da faixa anterior (caso real do curso) | UT-02 |
| `EXT-X-MAP` com `BYTERANGE` | `BYTERANGE="893@0"` | `initRange` = `{0, 893}` | UT-03 |
| Faixa inválida | NaN, 0, negativa, estouro | `HlsParseError` ⇒ `HLS_NOT_RESOLVED` | UT-04 |
| Offset implícito sem faixa anterior | 1º segmento ou troca de recurso sem `@` | `HlsParseError` ⇒ `HLS_NOT_RESOLVED` | UT-05 |
| Sem byte range | playlist comum (TS ou fMP4 em arquivos) | resultado idêntico ao de hoje, sem `ranges` | UT-06 |
| Comando inválido | `ranges` de tamanho errado, item inválido, `initRange` sem `initUrl` | comando rejeitado pelo offscreen | UT-07 |
| Compatibilidade | `start` e `HlsInfo` sem os campos novos | continuam aceitos | CT-01 |
| Cabeçalho | offset 1573, length 1060672 | `Range: bytes=1573-1062244` | UT-08 |
| Filtro do popup | `blob` + (arquivo ou HLS) / `blob` sozinho / só arquivos | `blob` some / `blob` fica / lista igual | UT-09, E2E-02 |
| Download com byte range | servidor com 206 correto | job `done`; MP4 = init + trechos na ordem; todas as requisições de mídia com `Range` | IT-01, E2E-01 |
| Servidor ignora `Range` | resposta 200 | job `failed` `FETCH_FAILED`; nada baixado/salvo | IT-02 |
| `Content-Range` divergente | 206 de outro intervalo | job `failed` `FETCH_FAILED` | IT-03 |
| Acima do limite | soma dos trechos > 1,5 GiB | `failed` `TOO_LARGE` sem requisição de mídia | IT-04 |
| Criptografado/DRM com byte range | `EXT-X-KEY` não-`NONE`, ou candidato `drm` | `ENCRYPTED`/`PROTECTED`; nenhuma requisição de mídia | IT-05 |
| Privacidade | URLs com `token`/`expires` | ausentes de diagnósticos, estado do job e erros | IT-06 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
N/A — o comportamento sem byte range já é coberto por `hls-segments*.test.ts`, `hls-job*.test.ts` e pelo E2E da SPEC-0012; UT-06 o fixa como guarda.

### 7.2 Testes Unitários
- **UT-01** — Dado uma playlist fMP4 com segmentos `#EXT-X-BYTERANGE:len@off`, quando `parseMediaSegments` roda, então `ranges[i]` = `{offset: off, length: len}` e `urls` ficam alinhados.
- **UT-02** — Dado a playlist real do curso (`MAP BYTERANGE="893@0"`, 1º segmento `1060672@1573`, demais só `len`), quando parseada, então cada offset é o fim do anterior (2º = 1573+1060672) e a soma bate com o último fim.
- **UT-03** — Dado `#EXT-X-MAP:URI=…,BYTERANGE="893@0"`, quando parseada, então `initRange` = `{offset:0, length:893}` e `initUrl` é o URL resolvido.
- **UT-04** — Dado BYTERANGE com `0`, negativo, texto, ou `offset+length` acima de `Number.MAX_SAFE_INTEGER`, quando parseada, então lança `HlsParseError`.
- **UT-05** — Dado um segmento `len` sem `@` sem faixa anterior no mesmo URL (1º segmento, ou depois de trocar de arquivo), quando parseada, então lança `HlsParseError`.
- **UT-06** — Dado playlists TS e fMP4 sem BYTERANGE (as fixtures atuais), quando parseadas, então o resultado é igual ao anterior e não tem `ranges` nem `initRange` (guarda: passa antes da mudança).
- **UT-07** — Dado comandos `start` com `ranges` de comprimento diferente de `urls`, item não-objeto/inválido, ou `initRange` sem `initUrl`, quando `isCommand` valida, então rejeita; com campos coerentes, aceita.
- **UT-08** — Dado `{offset:1573, length:1060672}`, quando o cabeçalho é montado, então vale `bytes=1573-1062244`.
- **UT-09** — Dado listas com `blob:` + arquivo, `blob:` + HLS, `blob:` sozinho, `blob:` + só outro `unsupported-stream`, e sem `blob:`, quando `hideRedundantCandidates` roda, então remove o `blob` só nos dois primeiros casos, preserva a ordem e não muta a entrada.

### 7.3 Testes de Integração
- **IT-01** — Dado um servidor local com suporte a `Range` servindo um fMP4 de arquivo único e a playlist com byte range, quando o job roda no offscreen real (harness da SPEC-0012), então termina `done`, o Blob é `init + trechos` na ordem (bytes conferidos) e toda requisição ao arquivo de mídia tem `Range` correto.
- **IT-02** — Dado um servidor que ignora `Range` e responde 200, quando o job roda, então termina `failed` `FETCH_FAILED` e `downloads.download` não é chamado.
- **IT-03** — Dado um servidor que responde 206 com `Content-Range` de outro intervalo, quando o job roda, então termina `failed` `FETCH_FAILED`.
- **IT-04** — Dado ranges cuja soma excede 1,5 GiB (só metadados, nenhum byte real), quando o job inicia, então termina `failed` `TOO_LARGE` e o servidor não recebe nenhuma requisição de mídia.
- **IT-05** — Dado playlist com byte range **e** `#EXT-X-KEY:METHOD=AES-128` (e um candidato `drm` com byte range), quando `download` roda, então responde `ENCRYPTED` (e `PROTECTED`) e o servidor não recebe requisição de mídia.
- **IT-06** — Dado playlist e segmentos com `?token=…&expires=…`, quando o job conclui e quando falha, então nenhuma saída de diagnóstico, erro ou estado do job contém o token.

### 7.4 Testes de Contrato
- **CT-01** — Dado o contrato `start` da SPEC-0012@1 (comando sem `ranges`/`initRange`) e `HlsInfo` da SPEC-0011@1, quando validados pelo código desta spec, então continuam aceitos sem alteração (compatibilidade aditiva), e um `start` com os campos novos também é aceito.

### 7.5 Testes E2E
- **E2E-01** — Dado uma página que carrega um HLS de arquivo único com byte range (fixture gerada com `ffmpeg`, servida com `Range`) [jornada: baixar-hls], quando o usuário abre o popup e clica em baixar, então aparece o progresso, o arquivo `.mp4` é salvo e é um MP4 válido (`ftyp` primeiro, `moov` e `mdat`, uma trilha de vídeo 320×180, duração ±0,6 s), em menos de 10 s, com axe sem violações sérias.
- **E2E-02** — Dado uma página com `<video>` por `blob:` e um HLS observado na rede, quando o popup abre, então não há `badge-unsupported` do `blob`; e com a página só com `blob:` o cartão continua (guarda: passa antes da mudança).

### 7.6 Outros
- **Desempenho:** tempo do E2E-01 registrado no relatório (alvo < 10 s).
- **Segurança:** coberta por IT-02, IT-03, IT-05, IT-06.

**Dublês e dados de teste:** servidor HTTP de teste com `Range` (`tests/integration/support/playlist-server.ts` e `e2e/support/fixture-server.ts`); fixture `e2e/fixtures/hls/single-file/` gerada por `ffmpeg -hls_segment_type fmp4 -hls_flags single_file` (comando acrescentado a `generate-video.sh`); a playlist do curso real, **sem token**, vira fixture textual para UT-02.

**Ambiente de execução:** Vitest (unit, integration) e Playwright com Chromium real, local e no CI (`pnpm test`, `pnpm test:integration`, `pnpm test:e2e`).

## 8. Plano de Rollout
- **Estratégia:** deploy direto na próxima pré-release (rc), validada pelo Thomas no curso real; sem feature flag (caminho sem byte range inalterado).
- **Dados/schema:** N/A.
- **Compatibilidade:** campos novos do `start` são opcionais; `MediaSegments` só ganha campos.
- **Observabilidade:** nenhum evento novo; falhas de `Range` aparecem como `FETCH_FAILED` no estado do job (sem URL).
- **Rollback:** reverter o PR (merge commit) e publicar nova rc; não há dado persistido a migrar.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
Nenhuma. (Premissas a confirmar no H1: esconder o `blob` só quando há outra fonte; a mensagem de erro existente `errorHlsNotResolved` não muda.)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN, após a aprovação. Cada fase começa pelos testes. -->

## 12. Registro de Gates
<!-- Status: PENDING | PASS | FAIL | N/A. PASS e N/A exigem evidência (comando + resultado, SHA, execução de CI, veredito). -->
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 69b3d0a | 2026-10-02 |
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
N/A

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
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0013`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
