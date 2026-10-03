---
id: ADR-0014
title: "Junção de trilhas MP4 (vídeo e áudio) com Mediabunny no offscreen"
status: proposed
origin: decision
date: 2026-10-02
pillars: [dependencias]
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "teste de arquitetura: mediabunny só em entrypoints/offscreen (dependency-cruiser); versão fixada no package.json (ADR-0008); testes de build de licença (SPEC-0014:UT-06/UT-07); prova de conceito da SPEC-0014 (fase 1) com ffprobe"
---

# ADR-0014 — Junção de trilhas MP4 (vídeo e áudio) com Mediabunny no offscreen

## Contexto e Problema
Plataformas de curso entregam HLS em que **vídeo e áudio são arquivos fMP4 separados** (`#EXT-X-MEDIA TYPE=AUDIO` + `EXT-X-STREAM-INF AUDIO="grupo"`). A SPEC-0012 só concatena os fragmentos de uma playlist; o resultado de um site assim é um MP4 **sem som**. É preciso combinar duas trilhas (uma de vídeo, uma de áudio, ambas com `track_ID` 1) em um único MP4 reproduzível, sem recodificar e dentro do offscreen document, com o limite de memória de 1,5 GiB já adotado (ADR-0013). Criptografia/DRM seguem recusados.

## Direcionadores da Decisão
- Resultado reproduzível em qualquer player, com áudio e vídeo sincronizados (cópia de pacotes, sem recodificar).
- Pouco código nosso a manter na parte mais delicada (caixas MP4, tempos, fragmentos).
- Licença compatível com MIT e com a loja; sem GPL no pacote distribuído (ADR-0008).
- Impacto pequeno no tamanho da extensão e carregamento apenas sob demanda, no offscreen.
- Biblioteca ativa, com tipos TypeScript.

## Opções Consideradas
- **A.** `mediabunny` (leitura e escrita de contêineres no navegador, TypeScript).
- **B.** `mp4box` (BSD-3) para extrair amostras de cada arquivo e reescrever.
- **C.** Código próprio: reescrever `moov` com duas trilhas e intercalar `moof`/`mdat`.
- **D.** `@ffmpeg/ffmpeg` + `@ffmpeg/core` (ffmpeg.wasm).

## Resultado da Decisão
**Opção escolhida (proposta):** "A. mediabunny", **condicionada à prova de conceito da fase 1 da SPEC-0014**: juntar um fMP4 só de vídeo e um só de áudio (formato real do curso) em um MP4 válido, conferido com `ffprobe` (duas trilhas `h264` e `aac`, duração e sincronia dentro da tolerância da spec). Se a prova falhar, vale a opção **C** (módulo próprio em `entrypoints/offscreen`, sem dependência nova), e este ADR passa a `superseded` por uma nota de decisão, sem nova versão de biblioteca.

**Regras (verificáveis):**
1. `mediabunny` só pode ser importado em `entrypoints/offscreen/**` (regra do dependency-cruiser, como `mux.js`); nunca em `src/core` ou no popup.
2. Versão exata fixada (sem `^`/`~`); nenhuma alteração nos arquivos da biblioteca (só uso como dependência), para não acionar a obrigação de publicar modificações da MPL-2.0.
6. **Licença no pacote, sem nada na interface:** os comentários de licença/copyright da biblioteca são preservados no chunk do offscreen (o minificador não pode removê-los; a MPL-2.0 proíbe retirar esses cabeçalhos) e `THIRD_PARTY_NOTICES.txt` vai na raiz dos zips, listando mediabunny (MPL-2.0), mux.js e m3u8-parser (Apache-2.0) com versão e texto da licença. Verificado por teste no build (SPEC-0014:UT-06/UT-07).
3. Somente cópia de pacotes: nenhum recodificar; criptografia (`sinf`/`schm`) no init de qualquer trilha ⇒ recusa, como na SPEC-0012.
4. O limite de 1,5 GiB considera a **soma** dos bytes das duas trilhas.
5. A biblioteca é carregada só no offscreen e só quando há faixa de áudio separada (importação dinâmica).

### Consequências
- **Boa**, porque a parte mais delicada (tempos, edit lists, intercalação) fica em código mantido por terceiros e testado em larga escala.
- **Boa**, porque o pacote só carrega no offscreen sob demanda; o custo para o usuário é zero fora do download.
- **Ruim**, porque é mais uma dependência a atualizar (Dependabot semanal) e a auditar; mitigado pela versão fixada e `pnpm audit`.
- **Ruim**, porque MPL-2.0 exige manter o aviso de licença e disponibilizar o código de arquivos modificados; mitigado por não modificar a biblioteca.

### Confirmação (G3)
`pnpm arch` falha se `mediabunny` for importado fora de `entrypoints/offscreen/**`; teste unitário garante a versão fixada; a prova de conceito é um teste de integração com fixtures reais (SPEC-0014:IT-01).

## Prós e Contras das Opções
| Critério (peso) | A. mediabunny | B. mp4box | C. código próprio | D. ffmpeg.wasm |
|---|---|---|---|---|
| Resultado correto sem recodificar (5) | 4 | 3 | 3 | 5 |
| Tamanho no pacote (4) | 4 | 4 | 5 | 1 |
| Licença compatível (4) | 4 | 5 | 5 | 1 |
| Esforço e risco de manutenção nossos (4) | 5 | 3 | 1 | 4 |
| Manutenção ativa do projeto (3) | 5 | 4 | 3 | 2 |
| Tipos TypeScript e API para ler/escrever (3) | 5 | 3 | 4 | 3 |
| **Total ponderado** | **102** | **84** | **80** | **64** |

Pesos e notas são julgamento do arquiteto, a serem confirmados pela prova de conceito (a nota de "resultado correto" de A é hipótese até a fase 1).

## Mais Informações
Dados verificados no registro npm em 2026-10-02 (`npm view`):
- `mediabunny` 1.61.0 — MPL-2.0, atualizada em 2026-09-29, 10,8 MB descompactado (bundle bem menor com tree-shaking; medir na fase 1).
- `mp4box` 2.4.1 — BSD-3-Clause, atualizada em 2026-06-19, 2,3 MB.
- `@ffmpeg/ffmpeg` 0.12.15 (MIT) + `@ffmpeg/core` 0.12.10 — GPL-2.0-or-later, 64,7 MB, última atualização em 2025-04-07.
- `mux.js` 6.3.0 (já em uso, Apache-2.0): transmuxa TS→MP4 mas não junta duas trilhas de MP4 fragmentado.
- README oficial da mediabunny (consultado em 2026-10-02, github.com/Vanilagy/mediabunny): MPL-2.0, "free to use for any purpose, including closed-source commercial use", sem royalties; patrocínio é opcional; obrigações: publicar modificações do código da biblioteca, não remover cabeçalhos de licença/copyright, não usar a marca; implementação em TypeScript puro, sem dependências.
- Teste manual do usuário (2026-10-02): `ffmpeg -i video.mp4 -i audio.mp4 -c copy` com os arquivos reais do curso gerou um MP4 reproduzível, indício de que a junção sem recodificar é viável para esse formato.
- Não verificado ainda: se a API da `mediabunny` aceita os dois fMP4 como entradas sem decodificar e escreve um MP4 não fragmentado com o tamanho de memória esperado — é o objetivo da fase 1.
