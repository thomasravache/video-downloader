---
id: SPEC-0024
title: "Detecção estável entre contas e páginas: falha parcial, re-detecção, rede e service worker"
tier: full
type: fix
user_facing: true
status: in-progress
created: 2026-11-26
parent: SPEC-0023
depends_on: []
consumes_contract: []
contract_version: 2
touches:
  - src/core/service.ts
  - src/core/network.ts
  - src/core/candidates.ts
  - src/core/contracts/**
  - src/core/messages.ts
  - entrypoints/background/index.ts
  - entrypoints/background/collect-videos.ts
  - entrypoints/popup/main.ts
  - entrypoints/popup/redetect.ts
  - src/core/ports.ts
  - entrypoints/popup/view.ts
  - entrypoints/popup/index.html
  - public/_locales/**
  - tests/unit/**
  - tests/integration/**
  - e2e/**
adrs: [ADR-0001, ADR-0002, ADR-0007, ADR-0009, ADR-0012]
external: []
size: M
approved_by: Thomas Ravache
approved_at: 2026-11-27
---

# SPEC-0024 — Detecção estável entre contas e páginas: falha parcial, re-detecção, rede e service worker

## 1. Visão Geral
Com a conta do dono logada, o vídeo aparece no popup. Com outras contas, nas mesmas plataformas e no flavor `local`, o popup fica vazio. A revisão do caminho de detecção achou defeitos que fazem a detecção depender do momento em que o popup é aberto, dos iframes da página, de como o servidor rotula o arquivo e de o site usar ou não um service worker. Esses fatores mudam de uma conta para outra. Esta spec corrige esses defeitos sem mudar a arquitetura: o popup passa a acompanhar os vídeos que aparecem enquanto está aberto, a falha de um frame deixa de esconder o que a rede capturou, e a captura de rede deixa de descartar respostas legítimas.

## 2. Motivação & Escopo
**Motivação:** relato do dono (2026-11-26): "com a minha conta logada funciona, mas se for em outras parece que a extensão não está boa"; sintoma escolhido: "vídeo não é detectado", flavor `local`. A suíte atual passa (602 testes), então os defeitos estão em caminhos sem teste. Achados confirmados na leitura do código:

| # | Defeito | Onde |
|---|---|---|
| D1 | Se a coleta no DOM falha (frame removido, navegação, frame com erro), `detect` devolve `RESTRICTED_PAGE` antes de ler a lista de rede, mesmo com `.m3u8` capturado | `src/core/service.ts:201-204` |
| D2 | O popup não trata a rejeição de `sendMessage('detect')` e fica em "procurando" para sempre | `entrypoints/popup/main.ts:268-274` |
| D3 | `<video>` dentro de shadow DOM (players em web component) não é encontrado | `entrypoints/background/collect-videos.ts:16` |
| D4 | A detecção roda uma vez só, ao abrir o popup. Se o player ainda não pediu o manifesto (autoplay desligado, "continuar de onde parou", play por clique), a lista fica vazia e nunca atualiza | `entrypoints/popup/main.ts` (`detect` único) |
| D5 | Segmentos fMP4 servidos como `.mp4` viram candidatos `file` e, passando de 50 por aba (`MAX_PER_TAB`), expulsam o manifesto HLS/DASH da lista | `src/core/network.ts:39,116-121,178` |
| D6 | `.mp4`/`.webm`/`.mov` só são aceitos com `video/*` ou `application/octet-stream`. Ficam de fora `binary/octet-stream` (padrão do S3), resposta sem Content-Type e `video/quicktime` | `src/core/network.ts:116-121` |
| D7 | A lista de rede da aba é apagada em qualquer `onBeforeRequest` de `main_frame`, inclusive em navegação que não troca a página (link de download, 204, navegação cancelada) | `entrypoints/background/index.ts:151-159` |
| D8 | Requisições feitas pelo service worker do site chegam com `tabId = -1` e são descartadas. Em quem já visitou o site, o player pode buscar tudo por ele | `src/core/network.ts:80` |
| D9 | O agrupamento por caminho ignora toda a query string. Duas aulas com `/hls/playlist.m3u8?id=A` e `?id=B` viram "fontes redundantes" do mesmo cartão | `src/core/candidates.ts:94-126`, `src/core/network.ts:259-277` |
| D10 | Toda resposta de rede de qualquer site faz `tabs.get` + leitura de `storage.session` + atualização do badge, mesmo quando é descartada. Em páginas com muitos segmentos, a fila atrasa o `detect` do popup | `entrypoints/background/index.ts:125-141` |

**Objetivos (dentro do escopo):**
- D1: o resultado da rede sempre entra no `detect`. `RESTRICTED_PAGE` só quando a coleta falha em todos os providers **e** a rede da aba não tem candidatos.
- D2: o popup mostra um estado de erro com "Tentar de novo" e registra `popup.detect_failed` no diagnóstico.
- D3: a coleta percorre shadow roots abertos (`element.shadowRoot`), com limite de profundidade.
- D4: enquanto o popup está aberto, ele acompanha a revisão da lista de rede da aba e refaz a detecção quando ela muda. Enquanto a lista estiver vazia, ele também refaz a coleta no DOM a cada 3 s, por até 30 s. Há também um botão "Procurar de novo".
- D5 (emenda v2): quando a aba tem um manifesto HLS/DASH, um candidato `file` é tratado como segmento e descartado só se estiver na mesma origem, no diretório do manifesto ou num subdiretório dele, **e** o nome do arquivo tiver forma de segmento: `^(seg|segment|chunk|frag|fragment|part|filesequence)[-_]?\d+\.(mp4|m4v)$` ou `^\d+\.(mp4|m4v)$`, sem diferenciar maiúsculas. Arquivos únicos na pasta do manifesto (como `v0.mp4`, `video-hi.mp4` e `audio-en.mp4`) continuam sendo fontes relacionadas, como na SPEC-0015. Ao passar do teto por aba, saem primeiro os `file`, e só depois os manifestos.
- D6: com extensão de vídeo conhecida, também são aceitos `binary/octet-stream`, `video/quicktime` (para `.mov`) e resposta sem Content-Type. O tamanho mínimo continua valendo.
- D7: a lista é apagada quando o documento principal da aba é de fato trocado. Isso é medido pelo `onResponseStarted` de `main_frame` com status 2xx diferente de 204/205 e sem `Content-Disposition: attachment`, e não mais pelo `onBeforeRequest`.
- D8: uma resposta com `tabId = -1` e `initiator` http(s) é atribuída às abas abertas cuja URL tem a mesma origem que o `initiator`. A extensão só vê abas onde já tem acesso, então no `public` só entram sites liberados (ADR-0012). Com mais de uma aba da mesma origem, a resposta entra em todas. O diagnóstico conta `network.sw_attributed`.
- D9: dois manifestos com o mesmo caminho só são agrupados se a query, sem os parâmetros de assinatura, for igual. Parâmetros de assinatura: `token`, `sig`, `signature`, `expires`, `exp`, `policy`, `key-pair-id`, `hdnts`, `hdnea`, `hmac`, `auth`, `acl`, `x-amz-*`, `x-goog-*`, comparados sem diferenciar maiúsculas. A mesma regra vale para `mergeCandidates`.
- D10: `tabs.get`, leitura da lista e atualização do badge só rodam quando a resposta foi classificada como candidato.

**Não-objetivos (fora do escopo):**
- Alinhar o visual do popup ao mockup do Stitch: spec separada, por decisão do dono (2026-11-26).
- Ícone, badge e indicador da toolbar: SPEC-0025.
- Navegação de SPA (troca de URL sem recarregar) apagando a lista: o comportamento atual continua e a lista é mantida.
- DASH, HLS ao vivo, DRM: continuam fora (README e ADR-0015).
- Respostas 304 e cota do `storage.session`: o risco é baixo e não foi verificado. Ficam como pendência.
- Lógica específica de YouTube dentro de `src/core/candidates.ts` (possível violação do ADR-0011) e typecheck só do flavor `public`: viram specs próprias.

## 3. Dependências
- **Implementações necessárias:** N/A — SPEC-0010, SPEC-0011, SPEC-0015 e SPEC-0016 já estão integradas na `main`
- **Contratos consumidos:** N/A — os contratos alterados são internos ao background/popup e versionados aqui
- **Pré-requisitos externos:** N/A — nenhuma permissão nova. `tabs.query` com filtro de URL usa o acesso a hosts que cada flavor já tem (ADR-0012)

## 4. Decisão Arquitetural
**Contexto:** projeto existente (TypeScript + WXT, MV3). A lógica pura fica em `src/core` (classificação, lista de rede, agrupamento, serviço) e é coberta por testes unitários. `entrypoints/background/index.ts` liga as APIs do Chrome às portas do core (ADR-0001, ADR-0010). O popup consulta o background por mensagens validadas em `src/core/messages.ts` e já usa polling para acompanhar jobs HLS (`entrypoints/popup/main.ts:128`). Implementações de referência: `classifyNetworkResponse` e `NetworkStore` (`src/core/network.ts`) para D5, D6 e D8; o polling de progresso de job no popup para D4; `createDetectService` (`src/core/service.ts`) para D1.

**Decisão:**
1. As regras de classificação, atribuição e agrupamento (D5, D6, D8, D9) entram como funções puras em `src/core/network.ts` e `src/core/candidates.ts`. O background só repassa dados do Chrome (`initiator`, a lista de abas de `tabs.query`).
2. A `NetworkStore` ganha uma `revision(tabId)`, incrementada em todo `add` efetivo e em todo `clear`. A mensagem nova `{ type: 'network-revision', tabId }` devolve `{ ok: true, revision }`. O popup consulta a revisão a cada 1 s, no mesmo padrão do polling de job, e refaz o `detect` quando ela muda.
3. `detect` deixa de encerrar na falha do DOM (D1). A falha continua no diagnóstico (`detect.provider_failed`) e só vira `RESTRICTED_PAGE` quando também não há nada na rede.

**Justificativa:** mantém a fronteira do ADR-0001: lógica testável no core, com APIs do navegador atrás de portas. Reaproveita o padrão de polling que o popup já tem. Não acrescenta permissões (ADR-0007, ADR-0012) nem dependências (ADR-0008).

**Desvio do padrão existente:** nenhum.

**Alternativas descartadas:**
- *O background avisar o popup por `runtime.Port`:* teria tempo real, mas cria um segundo canal de comunicação, além do polling que já existe. A latência de 1 s é aceitável.
- *Content script persistente com `MutationObserver` para achar `<video>` novos:* precisa de uma injeção estática em todas as páginas e aumenta a superfície. A re-coleta curta enquanto o popup está aberto resolve D4.
- *Permissão `webNavigation` para limpar a lista no commit (D7):* seria uma permissão nova. O `onResponseStarted` do `main_frame` já marca o mesmo momento.

**ADRs:** ADR-0001, ADR-0002, ADR-0007, ADR-0009, ADR-0012

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** o polling de revisão custa no máximo 1 mensagem/s e só existe com o popup aberto. A re-coleta no DOM dura no máximo 30 s. As respostas descartadas deixam de gerar `tabs.get`, leitura de storage e badge. Medição: IT-05 conta as chamadas às portas para 200 respostas descartadas.
- **Segurança:** a mensagem `network-revision` passa pela validação de `src/core/messages.ts` (só `tabId` inteiro ≥ 0) e é aceita só de páginas da própria extensão, como as outras. Verificado por UT-12 e pelo teste existente `message-security`.
- **Privacidade e dados pessoais:** a atribuição de requisições do service worker usa só a origem, sem caminho nem query. O diagnóstico registra contagens, nunca URLs com query (`redactUrls`, ADR-0009). Verificado por UT-09.
- **Disponibilidade e resiliência:** falha de frame, de provider ou de mensagem nunca deixa o popup preso: sempre aparece uma lista, um vazio ou um erro com "Tentar de novo" (UT-01, UT-11, IT-01).
- **Acessibilidade (UI):** o botão "Procurar de novo" e o estado de erro têm rótulo acessível. A atualização da lista usa `aria-busy` e `aria-live="polite"`, que o popup já tem. Verificado pela asserção de papel e nome no E2E-01.
- **Custo:** N/A — extensão local, sem serviço pago.

## 6. Artefato A — Contrato
**Interface:** funções do core, mensagem `network-revision` e comportamento do popup.

```ts
// src/core/network.ts
export interface NetworkResponse {
  // campos atuais + origem do iniciador como o Chrome informa
  initiator?: string;
}
/** D6: aceita também binary/octet-stream, video/quicktime (.mov) e Content-Type ausente com extensão de vídeo. */
export function classifyNetworkResponse(response: NetworkResponse): NetworkClassification | null;
/** D8: abas que recebem uma resposta sem aba (tabId = -1). Vazio quando initiator ausente/não http(s). */
export function attributeTabs(initiator: string | undefined, tabs: readonly { id: number; url?: string }[]): number[];
/** D5 (v2): true quando `file` está na mesma origem e no diretório (ou subdiretório) de um manifesto hls/dash E o nome tem forma de segmento (seg-1.mp4, chunk_3.mp4, fileSequence12.mp4, 0042.mp4). */
export function isManifestSegment(file: VideoCandidate, manifests: readonly VideoCandidate[]): boolean;
/** D7: true quando a resposta de main_frame troca o documento (2xx exceto 204/205, sem Content-Disposition attachment). */
export function replacesDocument(details: { statusCode: number; responseHeaders?: { name: string; value?: string }[] }): boolean;

export interface NetworkStore {
  // métodos atuais +
  /** Inteiro ≥ 0, incrementado a cada add efetivo e a cada clear da aba; 0 para aba sem histórico. */
  revision(tabId: number): Promise<number>;
}
// Eviction (D5): acima de MAX_PER_TAB saem primeiro os candidatos `file` mais antigos; manifestos só por último.

// src/core/candidates.ts
/** D9: chave de agrupamento = origem + caminho + query sem parâmetros de assinatura (ordenada). */
export function groupKey(url: string): string;

// src/core/service.ts — detect (D1)
// Coleta DOM falhou em todos os providers:
//   rede da aba com candidatos → { ok: true, candidates: <rede>, access } + log detect.provider_failed
//   rede vazia                 → { ok: false, error: 'RESTRICTED_PAGE' }   (como hoje)

// Mensagem nova (src/core/messages.ts + background)
type NetworkRevisionRequest = { type: 'network-revision'; tabId: number };
type NetworkRevisionResponse = { ok: true; revision: number } | { ok: false; error: 'INVALID_MESSAGE' };

// entrypoints/background/collect-videos.ts (D3)
// Percorre document e shadow roots abertos até profundidade 8; mesmo PageSnapshot de hoje.
```

**Popup (D2, D4):**
- Ao abrir: `detect` como hoje. Depois, com o popup aberto, consulta `network-revision` a cada 1 s. Se a revisão mudou, refaz o `detect` e redesenha a lista, mantendo a seleção de qualidade e de áudio dos cartões que continuam na lista.
- Enquanto a lista estiver vazia, refaz o `detect` a cada 3 s, por até 30 s desde a abertura.
- Botão "Procurar de novo" (`data-testid="redetect-button"`) sempre visível no rodapé: refaz o `detect` na hora.
- Se `detect` rejeitar ou não responder em 10 s: mensagem `popupDetectFailed` com "Tentar de novo" (`data-testid="detect-retry"`) e log `popup.detect_failed`.
- Um job de download em andamento nunca é interrompido nem redesenhado pela re-detecção.

**Design:** N/A — o popup ganha só um botão e um estado de erro, nos tokens visuais atuais (SPEC-0022). O alinhamento ao Stitch fica fora.

**Arquivos/módulos afetados:** ver `touches`. Testes novos em `tests/unit/network-*.test.ts`, `tests/unit/candidates-group-key.test.ts`, `tests/unit/collect-videos.test.ts`, `tests/integration/network-detect.test.ts` e `e2e/journeys/late-video.spec.ts`.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Falha do DOM com rede capturada | `executeScript` rejeita; a aba tem `.m3u8` na rede | `detect` devolve o candidato HLS; log `detect.provider_failed` | UT-01, IT-01 |
| Falha do DOM sem rede | `executeScript` rejeita; a rede está vazia | `RESTRICTED_PAGE` (como hoje) | UT-02, CH-01 |
| `detect` rejeita no popup | background lança erro ou não responde em 10 s | popup mostra erro + "Tentar de novo"; log `popup.detect_failed` | UT-11 |
| Vídeo em shadow DOM | `<video src>` dentro de um shadow root aberto | candidato aparece no snapshot | UT-03 |
| Vídeo carrega depois de abrir o popup | popup aberto com a lista vazia; player pede o `.m3u8` 5 s depois | popup mostra o vídeo sem reabrir | UT-10, E2E-01 |
| Botão "Procurar de novo" | clique | `detect` refeito na hora | E2E-01 |
| Re-detecção durante download | job HLS em andamento e a revisão muda | job e barra de progresso intactos | UT-10 |
| Segmento fMP4 `.mp4` | a aba tem um master `.m3u8` em `/v/abc/`; chega `/v/abc/seg-1.mp4` (200 KB) | segmento descartado; o master continua na lista | UT-04, IT-02 |
| Arquivo único na pasta do master | master em `/v/abc/`; chega `/v/abc/video-hi.mp4` | continua candidato `file` (fonte relacionada, SPEC-0015) | UT-04 |
| Muitas respostas `file` | mais de 50 `file` e 1 manifesto na aba | o manifesto continua; saem os `file` mais antigos | UT-05 |
| Content-Type alternativo | `.mp4` com `binary/octet-stream`, sem Content-Type, ou `.mov` com `video/quicktime` | candidato `file` | UT-06 |
| Content-Type alheio | `.mp4` com `text/html` | descartado (como hoje) | UT-06, CH-02 |
| Navegação real | `main_frame` 200 `text/html` | lista da aba apagada, revisão incrementada | UT-07, IT-03 |
| Navegação que não troca a página | `main_frame` 204, ou 200 com `Content-Disposition: attachment`, ou só `onBeforeRequest` sem resposta | lista mantida | UT-07, IT-03 |
| Requisição do service worker | `tabId = -1`, `initiator` = origem da aba 12 | candidato entra na aba 12; `network.sw_attributed` +1 | UT-08, IT-04 |
| Service worker sem aba correspondente | `tabId = -1`, `initiator` ausente ou sem aba com a mesma origem | descartado (como hoje) | UT-08 |
| Privacidade da atribuição | atribuição feita | o diagnóstico tem só a contagem; nenhuma URL com query | UT-09 |
| Aulas distintas no mesmo caminho | `/hls/playlist.m3u8?id=A` e `?id=B` | dois cartões | UT-13, IT-06 |
| Mesma aula com assinatura diferente | `?id=A&token=1` e `?id=A&token=2` | um cartão (fontes recolhidas) | UT-13 |
| Respostas descartadas não geram trabalho | 200 respostas de imagem/JS | 0 `tabs.get`, 0 leituras de storage, 0 badge | IT-05 |
| Revisão da lista | `network-revision` com `tabId` válido | `{ ok: true, revision }`, que cresce a cada add/clear | UT-12, CT-01 |
| Mensagem inválida | `network-revision` com `tabId` ausente, negativo ou não inteiro | `INVALID_MESSAGE` | UT-12 |
| Fluxo atual preservado | página com `<video src>` direto | lista e download como hoje | CH-01, E2E-02 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
- **CH-01** — Dado o `detect` atual, quando a coleta falha e a rede está vazia, então devolve `RESTRICTED_PAGE`; e para uma página com `<video src>` direto devolve um candidato `file`. (guarda: passa antes da mudança)
- **CH-02** — Dado `classifyNetworkResponse` atual, quando chegam `.mp4 video/mp4`, `.m3u8`, `.ts`, imagem e `.mp4 text/html`, então as classificações são as de hoje (`file`, `hls`, `null`, `null`, `null`). (guarda: passa antes da mudança)

### 7.2 Testes Unitários
- **UT-01** — Dado um provider cuja coleta lança erro e uma rede com um candidato HLS na aba, quando `detect` roda, então devolve `ok: true` com o candidato HLS e registra `detect.provider_failed`.
- **UT-02** — Dado um provider cuja coleta lança erro e uma rede vazia, quando `detect` roda, então devolve `RESTRICTED_PAGE`.
- **UT-03** — Dado um documento com `<video src>` dentro de um shadow root aberto (com outro shadow root aninhado), quando `collectVideos` roda, então o snapshot inclui os dois vídeos; e um aninhamento além da profundidade 8 é ignorado sem erro.
- **UT-04** — Dado um master em `https://cdn.x/v/abc/master.m3u8`, quando chega `https://cdn.x/v/abc/720/seg-1.mp4` com 200 KB, então `isManifestSegment` é verdadeiro e a lista não ganha um candidato `file`; e `https://cdn.x/outro/video.mp4` e `https://cdn.x/v/abc/video-hi.mp4` (arquivo único na pasta do master, fonte relacionada da SPEC-0015) continuam sendo candidatos.
- **UT-05** — Dada uma aba com 1 manifesto e 60 respostas `file` distintas, quando a lista passa do teto, então o manifesto continua e restam os 49 `file` mais recentes.
- **UT-06** — Dados `.mp4` com `binary/octet-stream`, `.mp4` sem Content-Type, `.mov` com `video/quicktime` e `.webm` com `application/octet-stream`, todos acima do tamanho mínimo, quando classificados, então viram `file`; e `.mp4` com `text/html` ou abaixo do mínimo é descartado.
- **UT-07** — Dados `replacesDocument` com 200 `text/html`, 204, 205, 200 com `Content-Disposition: attachment; filename=x.zip` e 200 com `Content-Disposition: inline`, então os resultados são verdadeiro, falso, falso, falso e verdadeiro.
- **UT-08** — Dado `attributeTabs` com o `initiator` `https://site.x` e as abas `[{12,'https://site.x/aula'}, {13,'https://outro.y/'}, {14, undefined}]`, então devolve `[12]`; com duas abas de `site.x`, devolve as duas; com `initiator` ausente, `null` ou `chrome-extension://…`, devolve `[]`.
- **UT-09** — Dada uma atribuição de service worker com uma URL que contém query, quando o diagnóstico é capturado, então ele tem `network.sw_attributed` com a contagem e nenhuma entrada contém `?`.
- **UT-10** — Dado o controlador de re-detecção do popup com o relógio falso, quando a revisão muda de 0 para 1, então chama `detect` uma vez e mantém a seleção do cartão que continua na lista; com a lista vazia, chama `detect` a cada 3 s e para depois de 30 s; com um job em andamento, não redesenha o cartão do job.
- **UT-11** — Dado `sendMessage('detect')` que rejeita ou não responde em 10 s, quando o popup detecta, então mostra `popupDetectFailed` com `detect-retry`, e o clique refaz o `detect`.
- **UT-12** — Dada a validação de mensagens, quando chega `{ type: 'network-revision', tabId: 3 }`, então é válida; e `tabId` ausente, `-1`, `1.5` ou string dá `INVALID_MESSAGE`.
- **UT-13** — Dado `groupKey`, quando recebe `…/playlist.m3u8?id=A` e `…/playlist.m3u8?id=B`, então as chaves são diferentes; e `?id=A&token=1&Expires=9` e `?Expires=3&id=A&token=2`, então as chaves são iguais.

### 7.3 Testes de Integração
- **IT-01** — Background com `fakeBrowser`: `scripting.executeScript` rejeita e a `NetworkStore` real (em `storage.session`) tem um `.m3u8` da aba. O `detect` pela mensagem devolve o HLS.
- **IT-02** — `onResponseStarted` alimenta um master e 70 segmentos `.mp4` da mesma pasta. `network.forTab` devolve só o master.
- **IT-03** — `onResponseStarted` de `main_frame` com 204 mantém a lista, e com 200 `text/html` apaga a lista e incrementa a revisão. Um `onBeforeRequest` de `main_frame` sem resposta não apaga nada.
- **IT-04** — `onResponseStarted` com `tabId = -1` e `initiator` igual à origem de uma aba aberta (`tabs.query` falso) põe o candidato na lista dessa aba.
- **IT-05** — 200 respostas descartadas (imagem/JS) não chamam `tabs.get`, `storage.session.get` nem `action.setBadgeText`.
- **IT-06** — Dois masters com o mesmo caminho e `id` diferente na query, capturados na mesma aba: o `detect` devolve dois candidatos que não são agrupados como redundantes.

### 7.4 Testes de Contrato
- **CT-01** — A mensagem `network-revision` aceita e devolve exatamente o formato da seção 6 (validação + resposta do background), e `NetworkStore.revision` é monotônica para add/clear.

### 7.5 Testes E2E
- **E2E-01** — [jornada: baixar-hls] Uma página de fixture só chama o player 5 s depois do carregamento, sem autoplay. O usuário abre o popup, que mostra a lista vazia; sem reabrir, o vídeo HLS aparece; o usuário baixa e recebe um MP4 válido. Também verifica que "Procurar de novo" tem papel de botão e nome acessível.
- **E2E-02** — [jornada: baixar-video-direto] A jornada atual (`e2e/journeys/download-video.spec.ts`) continua passando com a re-detecção ativa. Atualização do E2E existente.

### 7.6 Outros
- N/A — desempenho coberto por IT-05; não há requisito de segurança além de UT-12 e do teste `message-security` existente.

**Dublês e dados de teste:** `fakeBrowser` do WXT com `scripting`, `tabs.query` e `storage.session` falsos, já usados em `tests/integration/support`; relógio falso do Vitest para o polling; fixture HLS de `e2e/fixtures/hls` com uma página nova que atrasa o player.

**Ambiente de execução:** unitários e integração com Vitest local e no CI; E2E com Playwright e a extensão carregada (`pnpm test:e2e --flavor local` e `--flavor public`), como no CI atual.

## 8. Plano de Rollout
- **Estratégia:** deploy direto em uma nova release candidate (`0.1.0-rc.10`) pelo pipeline de release; sem feature flag (correção de comportamento).
- **Dados/schema:** a revisão da lista fica junto da lista no `storage.session`. Uma lista antiga sem revisão é lida como revisão 0. Nada é persistido em disco.
- **Compatibilidade:** popup e background são da mesma build, então a mensagem nova não tem cliente antigo.
- **Observabilidade:** logs novos `popup.detect_failed` e `network.sw_attributed` (contagem), além dos que já existem (`detect.provider_failed`, `detect.restricted`), todos no "Copiar diagnóstico".
- **Rollback:** reverter o merge na `main` e publicar a rc anterior (`0.1.0-rc.9`); o dono decide, em minutos.
- **Etapas de migração/coexistência:** N/A.

## 9. Questões em Aberto
- [x] De que contas se trata e qual o sintoma? — outras contas logadas no mesmo site, no flavor `local`; o vídeo não é detectado (Thomas Ravache, 2026-11-26)
- [x] O popup deve se atualizar sozinho enquanto está aberto? — Sim, além do botão "Procurar de novo" (Thomas Ravache, 2026-11-26)
- [x] Requisições do service worker do site (`tabId = -1`) entram nesta entrega? — Sim, atribuídas pela origem às abas abertas (Thomas Ravache, 2026-11-26)
- [x] Alinhar o popup ao mockup do Stitch entra aqui? — Não, vira uma spec separada (Thomas Ravache, 2026-11-26)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
**Fase 0: Caracterização**
- [x] CH-01 e CH-02 escritos com a tag `SPEC-0024:<ID>`, passando no código atual, commitados antes de qualquer mudança

**Fase 1: Rede (D5, D6, D8, D9, D10)**
- [x] Red: UT-04, UT-05, UT-06, UT-08, UT-09, UT-13, IT-02, IT-04, IT-05, IT-06 falhando pelo motivo certo
- [x] Green: `classifyNetworkResponse`, `attributeTabs`, `isManifestSegment`, eviction por tipo, `groupKey` e ligação no background, seguindo `src/core/network.ts`
- [x] Refactor mantendo tudo verde

**Fase 2: Navegação e revisão (D7, mensagem `network-revision`)**
- [x] Red: UT-07, UT-12, IT-03, CT-01 falhando pelo motivo certo
- [x] Green: `replacesDocument`, `NetworkStore.revision`, validação e resposta da mensagem; limpeza da lista movida para `onResponseStarted` de `main_frame`

**Fase 3: Detect e coleta (D1, D3)**
- [x] Red: UT-01, UT-02, UT-03, IT-01 falhando pelo motivo certo
- [x] Green: `detect` sempre inclui a rede; `collectVideos` percorre shadow roots abertos (profundidade 8)

**Fase 4: Popup (D2, D4)**
- [x] Red: UT-10, UT-11 falhando pelo motivo certo
- [x] Green: controlador de re-detecção (revisão a cada 1 s, DOM a cada 3 s por até 30 s com a lista vazia), botão `redetect-button`, erro com `detect-retry`, textos em `_locales`
- [x] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 5: Jornadas E2E**
- [x] Red: E2E-01 (player atrasado) falhando pelo motivo certo
- [x] Green: E2E-01 e E2E-02 passando localmente nos dois flavors

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy via pipeline com smoke/E2E no ambiente (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 0f94085 | 2026-11-26 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[30/30]⎯) — 02f0e65 | 2026-11-27 |
| G2 Green | PASS | build exit 0 (✔ Finished in 914 ms); test exit 0 (Duration  62.22s (tests 96%, import 2%, transform 1%)); lint exit 0 (✔ Finished in 193 ms); coverage exit 0 (================================================================================) — b44456e | 2026-11-27 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (66 modules, 145 dependencies cruised)) — b44456e | 2026-11-27 |
| G4 Review | PENDING | | |
| G5 Integração & CI | PENDING | | |
| H2 Integração aprovada | PENDING | | |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|
| IMP-01 | 2026-11-27 | G1 | decisão | next não despacha: touches em comum com SPEC-0009..0015, que seguem in-progress com G5 PASS e G7 pendente há 56 dias (código já na main) | waves/next após H1 | Thomas Ravache | Thomas escolheu fechar as specs antigas (2026-11-27): SPEC-0009..0015 e o épico SPEC-0008 fechados no PR #39 | 2026-11-27 |
| IMP-02 | 2026-11-27 | G2 | spec | D5 descarta todo file no diretório do manifesto e contradiz SPEC-0015 (fontes relacionadas .mp4 de arquivo único na mesma pasta): 9 IT e o E2E-01 da SPEC-0015 falham | D5 implementada como escrita; sem o descarte, só UT-04/IT-02 da SPEC-0024 falham | Architect | Emenda v2 — D5 estreitada a nomes de segmento; SPEC-0015 preservada (b44456e) | 2026-11-27 |

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
| 1 (escopo) | 2026-11-27 | `touches` ganha `entrypoints/popup/redetect.ts` (controlador de re-detecção do popup, sem DOM, exigido por UT-10/UT-11) e `src/core/ports.ts` (lista de abas para a atribuição D8). Testes antigos que fixam a limpeza em `onBeforeRequest` (SPEC-0010:IT-03 e a guarda de IT-06) passam a refletir a regra D7. A revisão fica numa chave própria do `storage.session` para não mudar o formato da lista. Contrato da seção 6 inalterado (`contract_version` 1) | descoberto no G1 pelo Test-writer | — | Architect, sob a autorização de piloto automático do Thomas (2026-11-27) |
| 2 | 2026-11-27 | D5 estreitada: só é segmento o `file` na pasta do manifesto (ou abaixo) com nome de segmento (`seg-N`, `chunk_N`, `fileSequenceN`, `N.mp4` etc.); a eviction prioriza manifestos. UT-04 ganha o caso `video-hi.mp4` que continua candidato | IMP-02: a D5 original contradizia a SPEC-0015 (fontes relacionadas `.mp4` de arquivo único) | SPEC-0024 (UT-04, IT-02); nenhuma spec consome o contrato | Thomas Ravache, pela autorização de piloto automático "com o recomendado" (2026-11-27) |
