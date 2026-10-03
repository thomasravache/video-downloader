---
id: ADR-0013
title: "Montagem de HLS: m3u8-parser e mux.js em offscreen document"
status: accepted
origin: decision
date: 2026-10-02
pillars: [dependencias]
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "teste de arquitetura: m3u8-parser só em src/core; mux.js só no offscreen (dependency-cruiser); versões fixadas no package.json (ADR-0008)"
---

# ADR-0013 — Montagem de HLS: m3u8-parser e mux.js em offscreen document

## Contexto e Problema
Para baixar HLS sem criptografia é preciso ler a playlist (master e mídia), buscar dezenas ou centenas de segmentos e juntá-los num arquivo reproduzível. No MV3 o service worker é efêmero e não tem DOM; blobs grandes e `URL.createObjectURL` pedem um contexto de documento. A decisão do usuário (2026-10-02) restringe o escopo a streams **sem criptografia**; AES-128 e DRM são recusados. *(Atualizado pelo ADR-0015: AES-128 com chave de sessão passa a ser permitido, só no flavor `local`.)*

## Direcionadores da Decisão
- Arquivo final reproduzível em qualquer player (MP4/H.264/AAC), sem exigir `.ts`.
- Pouco código nosso para manter; bibliotecas maduras e de licença compatível com MIT.
- Funcionar dentro das restrições do MV3 (offscreen document com a razão `BLOBS`).
- Tamanho do pacote e superfície de revisão da loja pequenos; sem WASM pesado.

## Opções Consideradas
- **A.** `m3u8-parser` (parse) + `mux.js` (transmux TS→MP4) rodando num offscreen document; fMP4 (`EXT-X-MAP`) apenas concatenado.
- **B.** Concatenar os segmentos TS e salvar como `.ts`, sem biblioteca de mux.
- **C.** `@ffmpeg/ffmpeg` (ffmpeg.wasm) para remuxar.

## Resultado da Decisão
**Opção escolhida:** "A", porque entrega MP4 reproduzível com duas bibliotecas pequenas e mantidas (video.js), em JavaScript puro, sem WASM nem requisitos de isolamento de origem.

**Regras (verificáveis):**
- `m3u8-parser` fica restrito a `src/core` (parse puro, sem APIs do navegador); `mux.js` e a montagem de blobs ficam só em `entrypoints/offscreen` e `src/` de apoio sem `chrome.*`.
- Playlist com `EXT-X-KEY` de `METHOD` diferente de `NONE` (incluindo `SAMPLE-AES`) ou `EXT-X-SESSION-KEY` é tratada como **protegida** e nunca baixada *(atualizado pelo ADR-0015: `AES-128` com chave de sessão passa a ser permitido, só no flavor `local`)*; playlist sem `EXT-X-ENDLIST` (ao vivo) é recusada.
- O offscreen document é criado sob demanda com a razão `BLOBS` e fechado ao fim do último job.
- Limite de memória: recusa com erro claro acima de 1,5 GiB bufferizados (o arquivo é montado em memória).
- Versões fixadas sem `^`/`~` (ADR-0008) e licença Apache-2.0 compatível com MIT.

### Consequências
- **Boa**, porque o usuário recebe um `.mp4` comum, com barra de progresso e cancelamento.
- **Boa**, porque as dependências são pequenas, de JavaScript puro e já usadas em players populares.
- **Ruim**, porque arquivos acima do limite de memória não são suportados nesta fase (streaming para disco fica para depois).
- **Ruim**, porque `mux.js` cobre H.264/AAC em TS; outros codecs (ex.: HEVC) falham com mensagem clara.
- **Ruim**, porque o uso de blob URL do offscreen em `chrome.downloads` não é documentado oficialmente e é provado por teste no Chromium real (SPEC-0012).

### Confirmação (G3)
Regras do dependency-cruiser (SPEC-0011/0012) que restringem onde cada biblioteca pode ser importada; `pnpm audit` e lockfile no CI (ADR-0008).

## Prós e Contras das Opções
| Critério (peso) | A. m3u8-parser + mux.js | B. só concatenar TS | C. ffmpeg.wasm |
|---|---|---|---|
| Arquivo reproduzível (MP4) (5) | 5 | 2 | 5 |
| Tamanho/complexidade (4) | 4 | 5 | 1 |
| Compatível com MV3 sem requisitos de isolamento (4) | 5 | 5 | 2 |
| Manutenção das libs (3) | 4 | 5 | 3 |
| **Total ponderado** | **72** | **61** | **49** |

## Mais Informações
Verificado no registro npm em 2026-10-02: `m3u8-parser` 7.2.0 (Apache-2.0, atualizado em 2026-09-09, ~530 KB desempacotado); `mux.js` 6.3.0 (Apache-2.0, atualizado em 2026-09-09, ~4,7 MB desempacotado incluindo builds, o bundle usado é menor); `@ffmpeg/ffmpeg` 0.12.15 (última atualização em 2025-04-07). API `chrome.offscreen`: razão `BLOBS` documentada em https://developer.chrome.com/docs/extensions/reference/api/offscreen (consultado 2026-10-02); no offscreen só `runtime` está disponível, e há no máximo um documento por perfil.
