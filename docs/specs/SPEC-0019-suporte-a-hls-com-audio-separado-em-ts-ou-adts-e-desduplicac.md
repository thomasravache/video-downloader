---
id: SPEC-0019
title: Suporte a HLS com audio separado em TS ou ADTS e desduplicacao no YouTube
tier: full
type: feature
user_facing: true
status: in-progress
created: 2026-10-07
parent:
depends_on: []
consumes_contract: [SPEC-0014@1, SPEC-0015@1]
contract_version: 1
touches:
  - src/core/**
  - entrypoints/offscreen/**
  - entrypoints/popup/**
  - tests/unit/**
  - tests/integration/**
  - e2e/journeys/**
adrs: [ADR-0014, ADR-0013, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-07
---

# SPEC-0019 — Suporte a HLS com audio separado em TS ou ADTS e desduplicacao no YouTube

## 1. Visão Geral
Habilita o download e a junção de streams HLS em que as trilhas de áudio separadas são distribuídas em contêineres TS ou fluxos elementares ADTS (AAC) sem tag `#EXT-X-MAP` (padrão utilizado pelo YouTube e reprodutores que usam `#EXT-X-VERSION:3`), combinando vídeo e áudio em um MP4 progressivo unificado via Mediabunny. Além disso, elimina cartões duplicados/fragmentados no popup recolhendo media playlists individuais que pertençam a uma master playlist capturada na mesma página, e exibe o identificador de codec nas opções de qualidade quando houver múltiplas variantes com a mesma resolução (priorizando H.264/AVC1 para máxima compatibilidade com reprodutores nativos de sistema como QuickTime e Windows Media Player).

## 2. Motivação & Escopo
**Motivação:**
Ao reproduzir vídeos no YouTube (e plataformas com streaming adaptativo similar), o navegador emite requisições para:
1. Uma **Master Playlist** (`.../hls_variant/.../file/index.m3u8`) contendo a lista completa de variantes de vídeo (144p até 4K em H.264 e VP9) e grupos de faixas de áudio alternativas (`AUDIO="233"`, `AUDIO="234"`).
2. Uma **Media Playlist** adaptativa isolada (`.../hls_playlist/.../itag/.../playlist/index.m3u8`) correspondente ao fluxo de vídeo específico que o player começou a tocar (stream puro de vídeo sem trilha de áudio embutida).

O comportamento atual apresentava duas falhas críticas reportadas pelo usuário:
- **Recusa `UNSUPPORTED` no cartão completo:** A SPEC-0014 assumiu que tanto o vídeo quanto o áudio separado seriam fragmentos fMP4 com `#EXT-X-MAP`. No YouTube, as media playlists de áudio não possuem `#EXT-X-MAP` (são streams AAC empacotados em TS/ADTS). A linha `if (!media.fmp4 || !audioMedia.fmp4)` em `src/core/service.ts` e a verificação `if (audio.initUrl === undefined)` em `entrypoints/offscreen/run-job.ts` recusavam o download com erro `UNSUPPORTED`, exibindo a mensagem *"This kind of video is not supported yet."*.
- **Cartões duplicados e download mudo:** O popup exibia dois cartões para o mesmo vídeo: um cartão de media playlist solta (sem seletores) e um da master playlist. O usuário que clicava no primeiro cartão baixava centenas de megabytes de vídeo sem nenhuma trilha de áudio.
- **Incompatibilidade de codec VP9:** O YouTube lista variantes VP9 e H.264 com a mesma resolução (ex: 1080p, 720p). Se o usuário escolhe VP9 por ter maior bitrate, o arquivo MP4 resultante não reproduz nativamente no QuickTime da Apple. O rótulo precisa distinguir os codecs e preferir H.264 por padrão.

**Objetivos (dentro do escopo):**
1. Suporte a áudio separado sem `#EXT-X-MAP`: permitir junção de vídeo (fMP4 ou TS) com áudio em formato TS ou ADTS AAC sem `initUrl` na faixa de áudio.
2. Atualização dos formatos de entrada no Mediabunny (`entrypoints/offscreen/merge.ts`): registrar `[MP4, ADTS, MPEG_TS]` na abertura dos inputs para permitir demuxing nativo sem recodificação.
3. Desduplicação / Recolhimento no popup e serviço: identificar quando uma media playlist capturada na aba pertence à lista de variantes de uma master playlist já capturada (mesmo origin/path ou URL de variante) e recolhê-la sob o cartão unificado da master playlist.
4. Identificação e ordenação de codecs no seletor de qualidade: indicar `(H.264)` ou `(VP9)` quando variantes tiverem a mesma resolução e priorizar H.264 na ordenação padrão.

**Não-objetivos (fora do escopo):**
1. Recodificação de vídeo (transcoding em CPU/GPU) de VP9 para H.264: apenas muxing/remuxing com cópia de pacotes (stream copy) sem decodificação de vídeo.
2. Quebra de DRM proprietário (Widevine/FairPlay): streams protegidos continuam sendo recusados conforme ADR-0015 e SPEC-0012.

## 3. Dependências
- **Implementações necessárias:** SPEC-0014 (junção de vídeo e áudio com mediabunny), SPEC-0015 (cartão por vídeo e recolhimento de redundantes), SPEC-0018 (transmuxer TS compatível).
- **Contratos consumidos:** SPEC-0014@1, SPEC-0015@1.
- **Pré-requisitos externos:** Nenhum. `mediabunny` já instalado na versão fixada 1.61.0 (ADR-0014).

## 4. Decisão Arquitetural
**Contexto:**
Segue estritamente as fronteiras de ADR-0001, ADR-0013 e ADR-0014. Todo processamento de mídia pesado (`mediabunny`, `mux.js`) reside exclusivamente em `entrypoints/offscreen`. `src/core` contém orquestração de candidatos, resolução de playlists e filtros de rede.

**Decisão:**
1. Em `src/core/service.ts`:
   - Em `downloadHls`, aceitar faixas de áudio onde `audioMedia.fmp4` é falso, desde que os segmentos de mídia sejam válidos.
   - Em `JobPlan`, o objeto `audio` torna `initUrl` opcional (`initUrl?: string`, `initRange?: ByteRange`).
   - Na listagem de candidatos para a aba (`findCandidates` / popup), suprimir candidatos de media playlist cuja URL coincida com a URL de alguma variante de um candidato master playlist existente na mesma aba.
2. Em `entrypoints/offscreen/run-job.ts`:
   - Quando `audio.initUrl` for `undefined`, baixar os segmentos da faixa de áudio no formato `'ts'` (ou áudio contínuo) e instanciar `audioBlob = new Blob(audioSegments)`.
   - Chamar `assembleMerged({ blob: videoBlob }, { blob: audioBlob })`.
3. Em `entrypoints/offscreen/merge.ts`:
   - Em `open(track)`, passar `formats: [MP4, ADTS, MPEG_TS]` para o `Input` do Mediabunny. O Mediabunny extrai nativamente os pacotes AAC e H.264/VP9 preservando timestamps e configurações de decoder.
4. Em `src/core/hls/index.ts` e `entrypoints/popup/view.ts`:
   - Extrair e normalizar informações de codec (`codecs` da tag `STREAM-INF`).
   - Se houver variantes com a mesma resolução (ex: duas de 1080p), enriquecer o rótulo para incluir o codec: ex: `1080p (H.264) · 4.6 Mbps` e `1080p (VP9) · 2.4 Mbps`.
   - Na ordenação padrão de variantes, em empate de resolução, ordenar variantes H.264 (`avc1`) antes de VP9 (`vp09`).

**Justificativa:**
Ajusta a validação para a realidade dos manifestos de streaming da web (onde faixas de áudio raramente usam fMP4 multiplexado e preferem fluxos ADTS leves), aproveita as capacidades nativas já presentes no Mediabunny sem adicionar novas bibliotecas, e melhora substancialmente a experiência do usuário com deduplicação de cartões e rótulos de codec claros.

**Desvio do padrão existente:**
Nenhum. Mantém as bibliotecas, convenções de código e isolamento arquitetural existentes.

**Alternativas descartadas:**
- Transcodificar VP9 para H.264 no navegador: descartado por exigir ffmpeg.wasm (65 MB, GPL, alto consumo de CPU/bateria, proibido por ADR-0008 e ADR-0014).
- Ignorar a master playlist e baixar apenas o stream tocado: descartado pois gera vídeos mudos sem trilha de áudio.

**ADRs:**
ADR-0014, ADR-0013, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** Junção via cópia de pacotes com Mediabunny sem decodificação completa; tempo de montagem < 3 segundos para vídeos de até 15 minutos em máquina padrão.
- **Segurança:** Isolamento mantido no offscreen document; nenhuma execução de código remoto; URLs de segmentos validadas como http(s).
- **Privacidade e dados pessoais:** URLs de manifestos sensíveis continuam sanitizadas em logs conforme ADR-0006; nenhum cabeçalho com cookies ou tokens exportado em telemetria.
- **Disponibilidade e resiliência:** Tolerância a variações de container de áudio (ADTS AAC ou MPEG-TS); falha em uma variante específica preserva as demais.
- **Acessibilidade (UI):** Rótulos de seleção de qualidade e áudio acessíveis via teclado e leitores de tela com atributos `aria-label` e textos descritivos claros.
- **Custo:** N/A — extensão puramente local, sem infraestrutura backend.

## 6. Artefato A — Contrato
**Interface:** `src/core/hls-download/contracts.ts`, `src/core/service.ts`, `entrypoints/offscreen/commands.ts`

```typescript
// Extensão em JobPlan e OffscreenStart (src/core/hls-download/contracts.ts)
export interface JobPlan {
  candidateId: string;
  providerId: string;
  variantIndex: number;
  filename: string;
  correlationId: string;
  urls: string[];
  initUrl?: string;
  fmp4: boolean;
  ranges?: (ByteRange | undefined)[];
  initRange?: ByteRange;
  encryption?: EncryptionPlan;
  audio?: {
    urls: string[];
    initUrl?: string;           // Tornado opcional para suportar faixas TS/ADTS sem EXT-X-MAP
    ranges?: (ByteRange | undefined)[];
    initRange?: ByteRange;
    encryption?: EncryptionPlan;
  };
}

// Extensão em OffscreenStart (entrypoints/offscreen/commands.ts)
export interface OffscreenStart {
  target: 'offscreen';
  type: 'start';
  jobId: string;
  urls: string[];
  initUrl?: string;
  fmp4: boolean;
  ranges?: (ByteRange | undefined)[];
  initRange?: ByteRange;
  audio?: {
    urls: string[];
    initUrl?: string;           // Opcional: undefined quando áudio for TS/ADTS sem init
    ranges?: (ByteRange | undefined)[];
    initRange?: ByteRange;
    encryption?: EncryptionPlan;
  };
  encryption?: EncryptionPlan;
}
```

**Arquivos/módulos afetados:** ver `touches` no frontmatter.
- `src/core/hls-download/contracts.ts` (ajuste de tipagem opcional em `audio.initUrl`)
- `src/core/service.ts` (validação de `downloadHls` permitindo `audioMedia.fmp4 === false`, recolhimento de variantes redundantes)
- `src/core/hls/index.ts` (extração de codec e ordenação preferencial H.264)
- `entrypoints/offscreen/merge.ts` (suporte a `[MP4, ADTS, MPEG_TS]` no `Input` mediabunny)
- `entrypoints/offscreen/run-job.ts` (fetch de áudio sem `initUrl` e montagem de blob)
- `entrypoints/popup/view.ts` (rótulos de qualidade com codec e supressão de variantes filhas da master)

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Seleção de áudio em master do YouTube | Master com múltiplos grupos de áudio (ex: 233 e 234) e idiomas | `chooseAudio` e `audioOptions` retornam faixas compatíveis com o grupo da variante selecionada | UT-01 |
| Aceitação de download com áudio TS/ADTS | Vídeo fMP4 e áudio TS/ADTS sem `#EXT-X-MAP` | `service.downloadHls` aprova o plano de job sem recusar com `UNSUPPORTED` | UT-02, IT-01 |
| Recusa em playlists corrompidas ou incompatíveis | Playlist de áudio corrompida ou tipo não-mídia | `service.downloadHls` recusa com `HLS_NOT_RESOLVED` ou erro apropriado | UT-03 |
| Enriquecimento e ordenação de variantes | Master com resoluções duplicadas em codecs distintos (AVC1 vs VP9) | Opções exibem codec no rótulo e variantes AVC1 têm precedência na ordenação padrão | UT-04 |
| Deduplicação de candidatos no popup | Master e media playlist da mesma aba onde a media playlist é variante da master | Cartão da media playlist individual é recolhido, restando apenas o cartão da master com seletores | UT-05, E2E-01 |
| Junção de vídeo fMP4 com áudio TS/ADTS | Trilha de vídeo fMP4 (VP9 ou H.264) e trilha de áudio TS/ADTS | `assembleMerged` gera MP4 válido contendo ambas as trilhas sem recodificar | UT-06, IT-03 |
| Preservação de fMP4 completo existente | Master e áudio onde ambos são fMP4 (comportamento da SPEC-0014) | Continua baixando e juntando normalmente sem regressão | CH-01 |
| Resolução completa de master YouTube | Master do YouTube com 18 variantes e 6 áudios | `service.resolveHls` extrai variantes, áudios e recursos sem falhas | IT-02 |
| Conformidade de contrato | Mensagens `JobPlan` e `OffscreenStart` | Tipos aceitam áudio sem `initUrl` e compilam em estrito | CT-01 |
| Jornada do usuário no YouTube | Usuário acessa página do YouTube com streams adaptativos | Popup exibe um cartão unificado, permite selecionar resolução e áudio e conclui download | E2E-01 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
- **CH-01** — Dado um cenário com master playlist e faixas de áudio onde ambos os streams possuem `#EXT-X-MAP` (formato Hotmart testado na SPEC-0014), quando o download é iniciado, então o fluxo é concluído com sucesso e gera MP4 válido com duas trilhas (guarda: passa antes da mudança).

### 7.2 Testes Unitários
- **UT-01** — Dado um manifesto master do YouTube com múltiplos `audioGroup` (233 e 234) e faixas com idiomas e dublagens, quando `chooseAudio` e `audioOptions` são consultados para uma variante de 720p (grupo 234), então apenas faixas do grupo 234 são oferecidas e a seleção do idioma Português (Brasil) retorna a faixa correta com index válido.
- **UT-02** — Dado um candidato HLS com vídeo fMP4 e áudio separado cujos segmentos são TS/ADTS sem `#EXT-X-MAP`, quando `downloadHls` é acionado, então o download não é recusado com `UNSUPPORTED`, gerando um `JobPlan` com `audio` sem `initUrl`.
- **UT-03** — Dado um candidato HLS com playlist de áudio retornando conteúdo inválido ou não-mídia, quando `downloadHls` tenta aprovar a playlist, então a requisição é recusada com `HLS_NOT_RESOLVED`.
- **UT-04** — Dado um manifesto master contendo variantes com mesma resolução em codecs diferentes (ex: 1080p AVC1 e 1080p VP9), quando as variantes são analisadas por `variantsOf`, então os rótulos incluem identificador de codec legível e a variante AVC1 é posicionada antes da variante VP9 de mesma resolução.
- **UT-05** — Dado uma lista de candidatos para uma aba contendo uma master playlist e uma media playlist cuja URL é uma das variantes da master, quando os candidatos são processados para renderização no popup, então a media playlist é suprimida/recolhida, exibindo apenas o cartão da master playlist.
- **UT-06** — Dado um buffer de vídeo fMP4 e um buffer de áudio ADTS/AAC (sem init MP4), quando `assembleMerged` é executado com Mediabunny, então a junção produz um arquivo MP4 com duas trilhas (vídeo e áudio) sincronizadas.

### 7.3 Testes de Integração
- **IT-01** — Dado o serviço HLS com download configurado, quando o download de uma master playlist com áudio TS/ADTS é disparado, então o job é criado no repositório de jobs e a mensagem de início é enviada ao offscreen document contendo a especificação da faixa de áudio sem `initUrl`.
- **IT-02** — Dado o fluxo `service.resolveHls` executado sobre a master playlist real do YouTube com 18 variantes e 6 trilhas de áudio, quando o resolvedor analisa as playlists, então o candidato resultante possui tipo `'master'`, 18 variantes normalizadas e a lista de faixas de áudio devidamente indexada.
- **IT-03** — Dado o executor `runOffscreenJob` recebendo um pedido de download com vídeo fMP4 e áudio TS/ADTS, quando os segmentos são baixados e processados, então o montador emite o evento `ready` contendo um Blob MP4 válido de vídeo e áudio.

### 7.4 Testes de Contrato
- **CT-01** — Dado o contrato `JobPlan` e `OffscreenStart`, quando instanciado com o campo `audio` sem a propriedade `initUrl`, então as estruturas de dados respeitam a assinatura do contrato e mantêm compatibilidade com o formato legado da SPEC-0014.

### 7.5 Testes E2E
- **E2E-01** — [jornada: baixar-hls] Dado que o usuário navega em um vídeo do YouTube com master playlist e media playlist capturadas na rede, quando abre o popup da extensão, então visualiza um único cartão de vídeo para o conteúdo com seletores de qualidade e áudio, seleciona a qualidade 720p e áudio em Português e inicia o download, observando a barra de progresso avançar até a conclusão.

### 7.6 Outros
- Performance: montagem do arquivo MP4 com mediabunny em memória sem bloqueio de thread principal verificado via execução assíncrona.
- Acessibilidade: elementos de seleção mantêm associação semântica de `<label>` e `id` no DOM.

**Dublês e dados de teste:**
Fixtures de playlists master e media reais do YouTube (anonimizadas) e fragmentos curtos reais de vídeo fMP4 e áudio ADTS para testes de montagem determinísticos.

**Ambiente de execução:**
Vitest para testes unitários e de integração (`pnpm test`); Playwright para jornada E2E (`pnpm test:e2e`).

## 8. Plano de Rollout
- **Estratégia:** Deploy direto no branch `main` via PR revisado. O suporte a áudio TS/ADTS amplia o alcance do downloader HLS sem alterar contratos públicos.
- **Dados/schema:** N/A — sem alterações em schemas persistentes.
- **Compatibilidade:** Retrocompatível com manifestos fMP4 puros (Hotmart) e manifestos TS puros existentes.
- **Observabilidade:** Métricas e logs existentes enriquecidos: evento `download.started` e `job.created` registram propriedade booleana `audioFmp4: boolean`.
- **Rollback:** Reversão do commit de merge via git caso ocorra regressão na junção fMP4 existente.

## 9. Questões em Aberto
Nenhuma.

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação

**Fase 0: Caracterização**
- [x] CH-01 escrito, passando no código atual, commitado antes de qualquer mudança (preserva fMP4 + fMP4 da SPEC-0014)

**Fase 1: Suporte a áudio separado TS/ADTS e contratos**
- [x] Red: escrever UT-01, UT-02, UT-03, CT-01 com a tag `SPEC-0019:<ID>` e confirmar que falham pelo motivo certo
- [x] Green: ajustar tipagem em `contracts.ts`, aceitar áudio sem fMP4 em `service.ts` e `run-job.ts`
- [x] Refactor mantendo tudo verde
- [x] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Muxing com Mediabunny e deduplicação no popup**
- [x] Red: escrever UT-04, UT-05, UT-06, IT-01, IT-02, IT-03 com a tag `SPEC-0019:<ID>` e confirmar que falham pelo motivo certo
- [x] Green: configurar `Input` com `[MP4, ADTS, MPEG_TS]` no `merge.ts`, implementar recolhimento de variantes redundantes e ordenação por codec compatível
- [x] Refactor mantendo tudo verde
- [x] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Jornada E2E**
- [x] Red: E2E-01 falhando pelo motivo certo
- [x] Green: jornada completa passando localmente
- [x] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase final: Integração, entrega e documentação**
- [x] Review independente (G4)
- [x] Integração + CI verde (G5) e aprovação (H2)
- [x] Deploy via pipeline com smoke/E2E no ambiente (G6)
- [x] Relatório de Entrega, docs raiz e CHANGELOG (G7)


## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — eb4b546 | 2026-10-07 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯) — 5f5ff51 | 2026-10-07 |
| G2 Green | PASS | build exit 0 (✔ Finished in 319 ms); test exit 0 (Duration  58.35s (tests 97%, import 2%, transform 1%)); lint exit 0 (✔ Finished in 177 ms); coverage exit 0 (================================================================================) — 966bef6 | 2026-10-07 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (64 modules, 139 dependencies cruised)) — 05ce852 | 2026-10-07 |
| G4 Review | PASS | verify G1+G4: PASS; revisão: Reviewer: APPROVED — escopo estrito em touches, 12/12 testes cobrem comportamentos, ajustes justificados — fadf833 | 2026-10-07 |
| G5 Integração & CI | PASS | build exit 0 (✔ Finished in 299 ms); test exit 0 (Duration  56.04s (tests 97%, import 2%, transform 1%)); test_integration exit 0 (at least ~450ms faster with isolate: false — reuses workers across files instead of one pe); test_e2e exit 0 (pnpm exec playwright show-report); arch_test exit 0 (✔ no dependency violations found (64 modules, 139 dependencies cruised)); security_scan exit 0 ([90m2:05PM[0m [32mINF[0m [1mno leaks found[0m) — 803a8b2 | 2026-10-07 |
| H2 Integração aprovada | PASS | política auto-on-green (aprovada por thomas em 2026-10-02); G5 PASS | 2026-10-07 |
| G6 Deploy | PASS | smoke_test exit 0 (pnpm exec playwright show-report) — 6af5020 | 2026-10-07 |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|

## 14. Relatório de Entrega

### O que foi entregue
Suporte completo a downloads de streams HLS em que a trilha de áudio é distribuída em formato TS ou ADTS AAC (sem `#EXT-X-MAP`), permitindo a junção nativa com vídeo fMP4 ou TS em um único arquivo MP4 progressivo via Mediabunny. Foi implementada também a desduplicação de cartões no popup (recolhendo media playlists individuais que pertençam a uma master playlist capturada na mesma página) e o enriquecimento de rótulos com identificador de codec (`(H.264)` vs `(VP9)`), priorizando H.264 para máxima compatibilidade com players nativos de sistema como QuickTime e Windows Media Player.

### Como foi feito
1. Em `src/core/hls-download/contracts.ts`: ajustada a interface `JobPlan` tornando `audio.initUrl` e `audio.initRange` opcionais.
2. Em `src/core/service.ts`: na função `downloadHls`, relaxada a exigência de `audioMedia.fmp4 === true`, aceitando áudio TS/ADTS sem init e repassando ao `JobPlan`.
3. Em `entrypoints/offscreen/run-job.ts`: ajustado o download de faixas de áudio para quando `audio.initUrl` for `undefined`, buscando os segmentos no formato `'ts'` e instanciando `audioBlob = new Blob(...)`.
4. Em `entrypoints/offscreen/merge.ts`: configurado `formats: [MP4, ADTS, MPEG_TS]` no `Input` do Mediabunny, viabilizando demuxing nativo de ADTS e TS sem recodificar.
5. Em `src/core/hls/index.ts`: normalizada a leitura e ranking de codecs em `variantsOf`, priorizando variantes H.264 sobre VP9 na ordenação de mesma resolução e adicionando rótulos explícitos quando há codecs concorrentes.
6. Em `entrypoints/popup/view.ts`: adicionada a desduplicação de cartões de variantes filhas que já pertencem a uma master playlist capturada na aba.

### Prova de Correção
N/A — spec do tipo feature (comportamento novo).

### Verificação
| Teste | Comportamento | Resultado | Evidência |
|---|---|---|---|
| CH-01 | Preservação de fMP4 completo (vídeo + áudio) da SPEC-0014 | PASS | tests/integration/hls-merge-job.test.ts (commit a90ea97) |
| UT-01 | Mapeamento de grupos de áudio (233 e 234) e idiomas no YouTube | PASS | tests/unit/hls-audio-youtube.test.ts |
| UT-02 | Aceitação de áudio TS/ADTS sem EXT-X-MAP no service.downloadHls | PASS | tests/unit/service-hls-audio.test.ts |
| UT-03 | Recusa de playlist de áudio corrompida com HLS_NOT_RESOLVED | PASS | tests/unit/service-hls-audio.test.ts |
| UT-04 | Rótulos de codec e priorização de H.264 sobre VP9 | PASS | tests/unit/hls-parse.test.ts |
| UT-05 | Deduplicação no popup suprimindo media playlists filhas da master | PASS | tests/unit/popup-view-dedup.test.ts |
| UT-06 | Junção de vídeo fMP4 com áudio ADTS sem init no Mediabunny | PASS | tests/unit/hls-merge-mediabunny.test.ts |
| IT-01 | Criação de job e start offscreen com áudio sem initUrl | PASS | tests/integration/hls-job-youtube.test.ts |
| IT-02 | Resolução de master real do YouTube com 18 variantes e 6 áudios | PASS | tests/integration/hls-merge-resolve.test.ts |
| IT-03 | Execução offscreen com vídeo fMP4 e áudio TS gerando evento ready | PASS | tests/integration/hls-job-audio-offscreen.test.ts |
| CT-01 | Contrato JobPlan e OffscreenStart aceita áudio sem initUrl | PASS | tests/unit/hls-merge-contract.test.ts |
| E2E-01 | Jornada completa de download no YouTube [jornada: baixar-hls] | PASS | e2e/journeys/hls-youtube.spec.ts |

### Definição de Pronto
- [x] Todos os testes do plano passando e listados na Verificação
- [x] Todo comportamento do Mapa de Comportamentos coberto e verificado
- [x] Suíte completa, arquitetura e CI verdes no resultado integrado (G5)
- [x] Review independente sem achados blocker/major (G4)
- [x] Padrão arquitetural existente mantido, ou desvio coberto por ADR aprovado
- [x] Requisitos não-funcionais medidos com evidência (ou N/A justificado)
- [x] Disponível no ambiente-alvo via pipeline, com smoke/E2E passando no ambiente (G6)
- [x] Observabilidade e rollback prontos conforme o Plano de Rollout
- [x] Documentação raiz e CHANGELOG atualizados (G7)
- [x] Pendências registradas como novas specs (ou nenhuma)

### Deploy
Integrado na branch `main` via PR #24 (commit merge `6af5020`). Smoke e E2E validados no gate G6.

### Pendências
Nenhuma.

## 15. Emendas
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
