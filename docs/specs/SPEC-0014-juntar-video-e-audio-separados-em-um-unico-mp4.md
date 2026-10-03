---
id: SPEC-0014
title: Juntar vídeo e áudio separados em um único MP4
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-02
parent: SPEC-0008
depends_on: []
consumes_contract: [SPEC-0011@1, SPEC-0012@1, SPEC-0013@1]
contract_version: 1
touches: [package.json, pnpm-lock.yaml, wxt.config.ts, .dependency-cruiser.cjs, public/THIRD_PARTY_NOTICES.txt, src/core/**, entrypoints/offscreen/**, entrypoints/popup/**, public/_locales/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**]
adrs: [ADR-0014, ADR-0013, ADR-0008, ADR-0006, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-02
---

# SPEC-0014 — Juntar vídeo e áudio separados em um único MP4

## 1. Visão Geral
Em muitos sites de curso o HLS entrega **vídeo e áudio em playlists e arquivos separados**: a playlist master lista as qualidades (`#EXT-X-STREAM-INF … AUDIO="grupo"`) e as faixas de áudio (`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="grupo",URI="…"`). Hoje a extensão baixa só a playlist de vídeo, e o arquivo sai **sem som**. Esta spec faz o download pela master **buscar também a faixa de áudio e juntar as duas trilhas num único MP4** (cópia de pacotes, sem recodificar), mantendo o seletor de qualidade que o cartão já tem. A limpeza do popup e o seletor de idioma ficam na SPEC-0015.

## 2. Motivação & Escopo
**Motivação:** teste manual da rc.2 num site de curso (2026-10-02): nenhum cartão baixava vídeo com áudio; o usuário juntou à mão `…_1080p.mp4` e `…_en_192k.mp4` com `ffmpeg -c copy` e o resultado tocou corretamente (evidência de que os arquivos aceitam junção sem recodificar).

**Objetivos (dentro do escopo):**
- Ler `#EXT-X-MEDIA TYPE=AUDIO` e o atributo `AUDIO=` das variantes; expor as faixas no candidato HLS (`HlsInfo.audio`, `HlsVariant.audioGroup`).
- Baixar, junto com a variante escolhida, a faixa de áudio do grupo dela (`DEFAULT=YES`, senão a primeira; `audioIndex` opcional no contrato para a SPEC-0015) e produzir **um único MP4** com as duas trilhas, via a biblioteca do ADR-0014 (prova de conceito na fase 1; plano B: módulo próprio).
- Aplicar as recusas de segurança a **todas** as playlists envolvidas (criptografia, DRM, ao vivo) e nunca entregar vídeo mudo quando o áudio esperado não pôde ser obtido.
- No cartão HLS, mostrar "Inclui áudio: <nome>" quando o download vai juntar áudio.
- Cumprir a licença MPL-2.0 da biblioteca: comentários legais preservados no bundle e arquivo de avisos de terceiros no pacote (com `mux.js` e `m3u8-parser`, Apache-2.0).

**Não-objetivos (fora do escopo):**
- Esconder/recolher cartões redundantes e seletor de idioma: SPEC-0015.
- Recodificar, mudar resolução/bitrate, extrair só o áudio, legendas.
- Áudio ou vídeo em TS com faixa separada (só fMP4 nas duas pontas; outro formato ⇒ `UNSUPPORTED`).
- DASH, MSE/`blob:`, criptografia/DRM de qualquer tipo.
- Casar áudio e vídeo sem playlist master (por nome de arquivo): sem master, a playlist de vídeo baixa só o vídeo, como hoje.

## 3. Dependências
- **Implementações necessárias:** N/A (vínculo por contrato).
- **Contratos consumidos:** SPEC-0011@1 (`HlsInfo`, `HlsVariant`, `parseHlsPlaylist`: **estendidos de forma aditiva**; registrar Emenda v2 aditiva na SPEC-0011 ao integrar); SPEC-0012@1 (mensagens e job); SPEC-0013@1 (`ByteRange`, `MediaSegments.ranges`, `start.ranges`: o áudio do curso também é arquivo único com byte range). Execução **depois** da SPEC-0013 (mesmos arquivos em `src/core/hls-download/**`).
- **Pré-requisitos externos:** biblioteca `mediabunny` (ADR-0014, aceito só se a fase 1 passar); `ffmpeg`/`ffprobe` locais para gerar fixtures e evidência manual.

## 4. Decisão Arquitetural
**Contexto:** mesmo desenho da SPEC-0012: núcleo puro em `src/core`, montagem de blobs no offscreen, `m3u8-parser` só no núcleo, biblioteca de mídia nova só no offscreen (regra de dependência igual à do `mux.js`). Segue `src/core/hls/index.ts`, `src/core/hls-download/*`, `entrypoints/offscreen/{assemble,run-job,commands}.ts`.

**Decisão:** (1) o parser expõe faixas de áudio e o grupo de cada variante; (2) `download` ganha `audioIndex?`; o serviço re-busca e re-analisa **a playlist de vídeo e a de áudio** (allowlist de criptografia, `live`, http(s), byte range) e só então cria o job; (3) o `start` do offscreen ganha `audio?`; (4) o offscreen baixa as duas trilhas, monta cada uma como fMP4 completo e as junta em `assembleMerged` (ADR-0014), carregando a biblioteca por importação dinâmica só nesse caso; (5) no resolve, além do melhor variante (SPEC-0011), busca-se a playlist de áudio padrão do grupo dele para marcar `encrypted` de forma conservadora (1 requisição a mais).

**Justificativa:** reutiliza job, agendador, progresso, cancelamento e limites; a fronteira de segurança continua no serviço (nada é baixado antes de todas as playlists serem aprovadas).

**Desvio do padrão existente:** dependência nova (`mediabunny`), coberta pelo ADR-0014 (aceito junto com o H1, condicionado à fase 1); sem a prova de conceito, plano B por emenda.

**Alternativas descartadas:** ffmpeg.wasm (GPL, 65 MB); entregar dois arquivos (UX ruim); código próprio como primeira opção (estimativa de centenas a mais de mil linhas na parte de tempos, `moov` e edit lists, com risco de dessincronia); casar áudio por nome de arquivo (frágil).

**ADRs:** ADR-0014 (novo), ADR-0013, ADR-0008, ADR-0006, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** fixture de 6 s concluída em < 10 s no E2E; aula real de 3:40 (≈ 63 MB) medida manualmente na rc. Resolve: no máximo 1 busca extra (a playlist de áudio padrão), 10 s e 1 MiB (limites do `playlist-fetcher`).
- **Segurança:** áudio criptografado/ao vivo/inválido ⇒ recusa total, sem nenhuma requisição de mídia (IT-03, IT-04, IT-07); `sinf/schm` no init de qualquer trilha ⇒ `ENCRYPTED`; nomes de faixa como texto (`textContent`), truncados e sem caracteres de controle (UT-02).
- **Privacidade e dados pessoais:** tokens e `expires` das URLs de áudio/vídeo nunca em logs, diagnósticos, erros ou estado do job (IT-09).
- **Disponibilidade e resiliência:** mesmas tentativas e cancelamento; cancelar interrompe as duas trilhas. **Memória:** o pico real da junção é **medido na fase 1** (IT-01, sintético de ≈ 200 MB) e o limite combinado de jobs com junção é fixado a partir dele como `pico ≤ 2 GiB`; valor provisório até a medição: 1 GiB na soma das duas trilhas, com `TOO_LARGE` antes da 1ª requisição quando declarado (IT-06). A medição e o valor final entram no Relatório de Entrega.
- **Acessibilidade (UI):** só o texto "Inclui áudio" novo, em `p.status` existente; axe sem violações sérias (E2E-01).
- **Custo:** N/A. **Tamanho do pacote:** registrar o acréscimo do bundle do offscreen na fase 1 (meta < 500 KB minificado).
- **Licença:** comentários legais da biblioteca presentes no bundle do offscreen e `THIRD_PARTY_NOTICES.txt` na raiz dos dois zips, sem nada na interface (UT-07).

## 6. Artefato A — Contrato
**Interface:** `parseHlsPlaylist` / `HlsInfo` (src/core/hls/index.ts); `chooseAudio` (src/core/hls-download); mensagem `download` (src/core/contracts); comando `start` do offscreen (src/core/hls-download/protocol.ts); `assembleMerged` (entrypoints/offscreen).

```text
// Extensões ADITIVAS de HlsInfo (SPEC-0011@1):
interface HlsAudioTrack {
  index: number            // posição na lista devolvida
  groupId: string          // GROUP-ID
  name: string             // NAME, sem controles, <= 80 caracteres
  language?: string        // LANGUAGE, <= 16 caracteres
  default: boolean         // DEFAULT=YES
  url: string              // URI resolvida; só http(s); faixa sem URI (áudio embutido na variante) não entra
}
HlsVariant.audioGroup?: string     // AUDIO="grupo" da STREAM-INF
HlsInfo.audio?: HlsAudioTrack[]    // máx. 20; ausente se a master não tem faixas com URI
// Resolve: se a playlist de áudio padrão do grupo do melhor variante for criptografada => HlsInfo.encrypted = true.
// Falha nessa busca extra não falha o resolve nem muda encrypted/live.

// chooseAudio(info, variantIndex, audioIndex?): HlsAudioTrack | 'none' | 'invalid'
//   variante sem audioGroup ou grupo sem faixas => 'none' (sem áudio separado, comportamento atual)
//   sem audioIndex => DEFAULT=YES do grupo, senão a primeira do grupo
//   audioIndex de outro grupo, inexistente, negativo ou não inteiro => 'invalid'

// Mensagem download (SPEC-0012@1) + campo opcional:
{ type:'download', candidateId, variantIndex?, audioIndex? }
// 'invalid' => UNSUPPORTED. Faixa de áudio ou vídeo que não seja fMP4 => UNSUPPORTED.
// Playlist de áudio: refetch + parse; erro => HLS_NOT_RESOLVED; criptografada => ENCRYPTED; ao vivo => LIVE.
// Nenhuma requisição de mídia antes de TODAS as playlists serem aprovadas.

// start do offscreen + campo opcional:
{ ..., audio?: { urls: string[], initUrl?: string, ranges?: (ByteRange|undefined)[], initRange?: ByteRange } }
// progresso: segmentsTotal/segmentsDone somam vídeo + áudio.
// Limite combinado (provisório 1 GiB; final pela medição da fase 1) => failed TOO_LARGE.
// 'sinf'/'schm' em qualquer init => failed ENCRYPTED.

// entrypoints/offscreen (assemble.ts ou merge.ts)
assembleMerged(video: {init, segments}, audio: {init, segments}): Promise<Uint8Array>
// Saída: MP4 com exatamente 2 trilhas (1 vídeo, 1 áudio), pacotes copiados sem recodificar,
// contagem de amostras igual à das fontes, duração de cada trilha ±0,2 s da fonte.
// Falha de junção => AssemblyError('ASSEMBLY_FAILED'); codec não suportado => 'UNSUPPORTED_CODEC'.

// Build: comentários legais (/*! … */ e @license) da biblioteca preservados no chunk do offscreen;
// public/THIRD_PARTY_NOTICES.txt (nome, versão, licença e texto de mediabunny, mux.js, m3u8-parser) na raiz do zip.
```

**Design:** cartão HLS existente + texto "Inclui áudio: <nome>" (`audio-included`) quando `chooseAudio` da variante selecionada devolve uma faixa; chave i18n `audioIncluded` em pt_BR e en. Nenhuma outra tela muda.

**Arquivos/módulos afetados:** ver `touches`; novos: módulo de junção no offscreen, `public/THIRD_PARTY_NOTICES.txt`, fixture `e2e/fixtures/hls/split-av/**`, página `pages/hls-split-av.html`.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Parser lê áudio | master com `EXT-X-MEDIA TYPE=AUDIO` e `AUDIO=` | `audio[]` e `variant.audioGroup` corretos | UT-01 |
| Entrada hostil | NAME gigante/controle, URI não http(s), >20 faixas, faixa sem URI | truncado/sanitizado, descartado, limitado | UT-02 |
| Escolha de áudio | padrão, índice válido, inválido, sem grupo | default → primeira; escolhida; `invalid`; `none` | UT-03 |
| Comando com áudio | `audio` válido/inválido | aceito / rejeitado | UT-04 |
| Texto no cartão | variante com e sem áudio separado | "Inclui áudio: <nome>" / nada | UT-05 |
| Licença no pacote | build dos dois flavors | avisos e comentários legais presentes | UT-06, UT-07 |
| Junção correta | fMP4 só vídeo + fMP4 só áudio | MP4 com 2 trilhas, sem perda de amostras; pico de memória medido | IT-01 (prova de conceito) |
| Download com áudio | master + vídeo e áudio com byte range | job `done`; Blob com as duas trilhas; progresso soma ambos | IT-02, E2E-01 |
| Áudio criptografado | `EXT-X-KEY` na playlist de áudio | `ENCRYPTED`; nenhuma requisição de mídia (nem do vídeo) | IT-03, E2E-02 |
| Áudio indisponível/ao vivo/inválido | 404, `live`, parse falha | `HLS_NOT_RESOLVED`/`LIVE`; nunca vídeo mudo; nada salvo | IT-04 |
| Opções inválidas | `audioIndex` inválido; áudio ou vídeo TS | `UNSUPPORTED`; nada baixado | IT-05 |
| Limite | soma acima do limite combinado | `failed` `TOO_LARGE` sem requisição de mídia | IT-06 |
| `sinf/schm` no init | init de áudio ou vídeo criptografado | `failed` `ENCRYPTED`; nada salvo | IT-07 |
| Resolve com áudio | master com áudio | busca a playlist de áudio padrão; `encrypted` conservador; falha extra não derruba | IT-08 |
| Privacidade | tokens nas URLs de áudio | ausentes de diagnósticos/estado/erros | IT-09 |
| Compatibilidade | payloads sem campos novos | continuam válidos | CT-01 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
N/A — parser, job e popup já cobertos pelas SPEC-0011/0012/0013; masters sem áudio separado ficam cobertas por CT-01 e pelos E2E existentes.

### 7.2 Testes Unitários
- **UT-01** — Dado uma master com `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="a.m3u8"` e variantes com `AUDIO="a1"`, quando `parseHlsPlaylist` roda, então `audio[0]` tem nome, idioma, `default`, `url` resolvida e `variants[i].audioGroup === 'a1'`.
- **UT-02** — Dado NAME com 10 mil caracteres/controles/aspas e vírgulas dentro de aspas, URI `javascript:`/`data:`/vazia, faixa sem URI e 30 faixas, quando parseada, então NAME é truncado em 80 sem controles, faixas inválidas são descartadas e há no máximo 20.
- **UT-03** — Dado variante com grupo e faixas (uma `DEFAULT`), quando `chooseAudio` roda sem índice, com índice válido, com índice de outro grupo/negativo/não inteiro, e com variante sem grupo, então devolve a default (senão a primeira), a escolhida, `invalid` e `none`.
- **UT-04** — Dado comandos `start` com `audio` válido, `audio.urls` vazio ou não-http(s), `audio.ranges` de tamanho errado e `audio.initRange` sem `initUrl`, quando `isCommand` valida, então aceita só o válido.
- **UT-05** — Dado candidatos HLS com variante de áudio separado e sem, quando o texto do cartão é calculado, então é "Inclui áudio: English" no primeiro e ausente no segundo (função pura, sem DOM).
- **UT-06** — Dado o build `public` e o `local`, quando os zips são inspecionados, então `THIRD_PARTY_NOTICES.txt` está na raiz e cita mediabunny (MPL-2.0), mux.js e m3u8-parser (Apache-2.0) com as versões do `package.json`.
- **UT-07** — Dado o chunk do offscreen do build, quando inspecionado, então contém os comentários de licença da mediabunny; e `mediabunny` aparece no `package.json` com versão exata (sem `^`/`~`).

### 7.3 Testes de Integração
- **IT-01** — (prova de conceito, fase 1, portão) Dado um fMP4 só de vídeo (H.264) e um só de áudio (AAC) gerados com `ffmpeg` no formato do curso, quando `assembleMerged` roda, então a saída tem `ftyp`+`moov` com exatamente 2 trilhas (`vide`, `soun`), contagem de amostras igual à das fontes e durações ±0,2 s; o resultado também é validado com `ffprobe` como evidência manual; pico de memória e tempo registrados com um sintético de ≈ 200 MB.
- **IT-02** — Dado master + playlist de vídeo + playlist de áudio, todas com byte range, servidas com `Range`, quando o job roda, então termina `done`, o Blob tem as duas trilhas, o progresso soma vídeo e áudio e as requisições de ambos têm `Range` correto.
- **IT-03** — Dado áudio com `#EXT-X-KEY:METHOD=AES-128` e vídeo limpo, quando `download` roda, então responde `ENCRYPTED` e o servidor não recebe nenhuma requisição de mídia (nem do vídeo).
- **IT-04** — Dado playlist de áudio com 404, ao vivo ou inválida, quando `download` roda, então responde `HLS_NOT_RESOLVED`/`LIVE`/`HLS_NOT_RESOLVED`, sem requisição de mídia e sem `downloads.download`.
- **IT-05** — Dado `audioIndex` inválido, e áudio ou vídeo em TS, quando `download` roda, então responde `UNSUPPORTED` sem requisição de mídia.
- **IT-06** — Dado ranges de vídeo+áudio com soma acima do limite combinado (só metadados), quando o job inicia, então termina `failed` `TOO_LARGE` sem requisição de mídia.
- **IT-07** — Dado init (de áudio e, em outro caso, de vídeo) com `sinf`/`schm`, quando o job roda, então termina `failed` `ENCRYPTED` e nada é salvo.
- **IT-08** — Dado uma master com áudio, quando `resolveHls` roda, então busca uma única playlist extra (a de áudio padrão), marca `encrypted` se ela for criptografada, e uma falha nessa busca não falha o resolve nem muda `encrypted`/`live`.
- **IT-09** — Dado URLs de vídeo e áudio com `?token=…&expires=…`, quando o job conclui ou falha, então nenhum diagnóstico, erro ou estado do job contém o token.

### 7.4 Testes de Contrato
- **CT-01** — Dado `HlsInfo`, `download` e `start` sem os campos novos (SPEC-0011@1, SPEC-0012@1, SPEC-0013@1), quando validados pelo código desta spec, então continuam aceitos; com os campos novos, também.

### 7.5 Testes E2E
- **E2E-01** — Dado uma página que carrega uma master com vídeo e áudio em fMP4 de arquivo único (fixture `ffmpeg`, servida com `Range`) [jornada: baixar-hls], quando o popup abre, então o cartão master mostra "Inclui áudio", e ao baixar o arquivo salvo é um MP4 válido com **duas trilhas** (`vide` 320×180 e `soun`), duração ±0,6 s, em < 10 s, com axe sem violações sérias.
- **E2E-02** — Dado uma master cujo áudio é criptografado, quando o popup abre, então o cartão mostra `badge-encrypted` e não há botão de baixar.

### 7.6 Outros
- **Tamanho:** acréscimo do bundle do offscreen registrado (meta < 500 KB minificado).
- **Segurança:** IT-03, IT-04, IT-07 e o fuzz do parser (UT-02).

**Dublês e dados de teste:** servidor com `Range` (SPEC-0013); fixtures `e2e/fixtures/hls/split-av/` (`ffmpeg -an`/`-vn`, `-hls_segment_type fmp4 -hls_flags single_file`), comando acrescentado a `generate-video.sh`.

**Ambiente de execução:** Vitest e Playwright com Chromium real, local e no CI.

## 8. Plano de Rollout
- **Estratégia:** deploy direto na próxima rc; sem flag. A biblioteca é importada dinamicamente só quando há áudio separado.
- **Dados/schema:** N/A.
- **Compatibilidade:** campos aditivos; masters sem áudio separado funcionam como hoje.
- **Observabilidade:** estado do job com os erros existentes; nenhum evento novo com URL.
- **Rollback:** reverter o PR e publicar nova rc; sem dados persistidos.
- **Etapas de migração/coexistência:** N/A.
- **Fase 1 (portão):** a prova de conceito IT-01 decide a biblioteca. Se falhar, o Implementer **para** e reporta `SPEC_DEFECT`; o arquiteto abre emenda para o plano B (módulo próprio) e o ADR-0014 é substituído.

## 9. Questões em Aberto
Nenhuma. (Premissas a confirmar no H1: a master do curso segue o padrão `EXT-X-MEDIA`/`AUDIO=` do RFC 8216; limite combinado provisório de 1 GiB até a medição; ADR-0014 aceito apenas se a fase 1 passar.)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN, após a aprovação. Cada fase começa pelos testes. -->
**Fase 1: Prova de conceito da biblioteca (portão)**
- [ ] Red: IT-01 (fMP4 só vídeo + só áudio gerados por ffmpeg) falhando
- [ ] Green com `mediabunny` (ADR-0014): 2 trilhas, amostras iguais, durações ±0,2 s, ffprobe, pico de memória e tamanho do bundle registrados; se falhar: PARAR e reportar SPEC_DEFECT (plano B por emenda)

**Fase 2: Parser, contrato e segurança**
- [ ] Red: UT-01..UT-07, CT-01, IT-02..IT-09 com a tag `SPEC-0014:<ID>`
- [ ] Green: `HlsInfo.audio`/`audioGroup`, `chooseAudio`, `download.audioIndex`, `start.audio`, recusas em todas as playlists, limite combinado (valor final pela medição), licenças no build
- [ ] Refactor e validar: build + suíte + arquitetura (G2/G3)

**Fase 3: Jornada E2E**
- [ ] Red: E2E-01 e E2E-02 falhando pelo motivo certo
- [ ] Green: jornada completa nos dois flavors, 3 execuções sem flake

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Release rc com smoke/E2E no pipeline e teste manual do Thomas (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)


## 12. Registro de Gates
<!-- Status: PENDING | PASS | FAIL | N/A. PASS e N/A exigem evidência (comando + resultado, SHA, execução de CI, veredito). -->
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 2482d6e (árvore suja) | 2026-10-02 |
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
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0014`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
