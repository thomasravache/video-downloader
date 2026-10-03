---
id: SPEC-0017
title: HLS com criptografia AES-128 por chave de sessão no flavor local
tier: full
type: feature
user_facing: true
status: approved
created: 2026-10-03
parent: SPEC-0008
depends_on: []
consumes_contract: [SPEC-0011@1, SPEC-0012@1, SPEC-0013@1, SPEC-0014@1, SPEC-0016@1]
contract_version: 1
touches: [wxt.config.ts, .dependency-cruiser.cjs, README.md, docs/runbook.md, scripts/release/**, scripts/build/**, src/aes128/**, src/core/**, entrypoints/background/**, entrypoints/offscreen/**, entrypoints/popup/**, public/_locales/**, e2e/support/**, e2e/journeys/**, e2e/fixtures/**, tests/unit/**, tests/integration/**, tests/release/**]
adrs: [ADR-0015, ADR-0013, ADR-0011, ADR-0008, ADR-0006, ADR-0001]
external: []
size: M
approved_by: thomas
approved_at: 2026-10-03
---

# SPEC-0017 — HLS com criptografia AES-128 por chave de sessão no flavor local

## 1. Visão Geral
Hoje qualquer tag de chave diferente de `#EXT-X-KEY:METHOD=NONE` faz o vídeo aparecer como "protegido" e ser recusado. O ADR-0015 (aceito em 2026-10-03) permite uma exceção estreita: **HLS `METHOD=AES-128` com a chave entregue por URI ao player da própria sessão do usuário**. Nesta spec a funcionalidade existe só no flavor `local`; o alcance por build é decisão do Thomas e fica fora do ADR. Esta spec implementa essa exceção (caso real de uma plataforma de curso: master com `EXT-X-SESSION-KEY:METHOD=AES-128` e chave em URL assinada). O download busca a chave na URL da playlist, descriptografa cada segmento no offscreen com WebCrypto e segue o fluxo normal de montagem. DRM de verdade, outros métodos/formatos de chave e o flavor `public` continuam recusando.

## 2. Motivação & Escopo
**Motivação:** teste manual numa plataforma de curso (2026-10-03): a master traz `EXT-X-SESSION-KEY:METHOD=AES-128,URI="https://keys.cdn-exemplo.test/…key?hdntl=…"`; o usuário toca o vídeo na própria conta e pediu poder baixá-lo (aprovado no ADR-0015, começando só pelo `local`).

**Objetivos (dentro do escopo):**
- Classificar chaves com **allowlist estrita**: `METHOD=NONE` (limpo) e `METHOD=AES-128` com atributos exatamente permitidos; tudo mais continua "protegido".
- Extrair, por segmento (e init), a chave e o IV aplicáveis (rotação de chave, IV explícito ou derivado da sequência de mídia).
- Buscar cada chave **no offscreen**, pela URI da playlist, com o contexto da SPEC-0016 quando a CDN exigir; validar 16 bytes; importar como `CryptoKey` não extraível; descartar o material ao fim.
- Descriptografar segmentos (e init) com `AES-CBC`/PKCS7, validar o resultado (sanidade TS/fMP4) e reaproveitar a montagem existente (TS via mux.js, fMP4 por concatenação/junção, byte range, áudio separado).
- Garantir por teste e por `flavor-guard` que o código de descriptografia **não existe** no build `public`.
- Popup (`local`): cartão baixável com aviso "Criptografado (AES-128): será descriptografado com a chave da sua sessão"; `public` inalterado (`badge-encrypted`).
- Documentar o uso responsável (README e runbook).

**Não-objetivos (fora do escopo):**
- Qualquer DRM: Widevine, PlayReady, FairPlay (`KEYFORMAT` ≠ identity), `SAMPLE-AES`/CENC, `EXT-X-FAXS-CM`, páginas com `MediaKeys`/EME.
- Obter a chave por outro meio que não a URI da playlist; reutilizar token de outra aula/sessão; persistir ou enviar chaves a qualquer lugar.
- Flavor `public` (decisão futura do Thomas); legendas e listas I-frame.
- Descriptografia em streaming (cada segmento é descriptografado inteiro em memória).

## 3. Dependências
- **Implementações necessárias:** N/A (vínculo por contrato). Execução **depois** da SPEC-0016 (a busca da chave usa o contexto de requisição).
- **Contratos consumidos:** SPEC-0011@1 (`HlsInfo`, allowlist de chave: **estendida só quando a política de chave está presente**), SPEC-0012@1 (`start`, `JobError`), SPEC-0013@1 (`ranges`), SPEC-0014@1 (`audio`), SPEC-0016@1 (lease de contexto). Mudanças são aditivas (§6) e entram como emendas aditivas ao integrar.
- **Pré-requisitos externos:** `ffmpeg` local para gerar fixture AES-128 (`-hls_key_info_file`); nenhuma dependência npm nova (WebCrypto).

## 4. Decisão Arquitetural
**Contexto:** `src/core/hls/index.ts` (`hasEncryptedKey`, allowlist), `src/core/hls-download/segments.ts`, `entrypoints/offscreen/{run-job,assemble,commands}.ts`; mecanismo de flavor por módulo virtual (`virtual:providers`, ADR-0011) e `scripts/release/flavor-guard.ts`; ADR-0015 (regras 1–6).

**Decisão:** (1) novo pacote `src/aes128/**` com o analisador de tags de chave, o construtor de plano (`EncryptionPlan`) e a descriptografia; (2) um plugin de build fornece **módulos virtuais** `virtual:aes128-policy` (background) e `virtual:aes128-decrypt` (offscreen): no flavor `local` resolvem para as implementações reais; no `public` resolvem para stubs que apenas dizem "AES-128 = protegido" — logo o código real nem entra no bundle `public`; (3) `src/core` não importa `src/aes128` (regra do dependency-cruiser): recebe uma **porta opcional** `KeyPolicyPort` por injeção; sem a porta (público e testes antigos) vale a allowlist atual (`hasEncryptedKey`); (4) com a porta, `parseHlsPlaylist` devolve `aes128: true` e `encrypted: false` para playlists cujas chaves são todas AES-128 válidas, e o serviço monta o `EncryptionPlan` ao re-analisar a playlist no download; (5) o `start` do offscreen carrega o plano (URLs de chave e IVs, nunca bytes de chave); o offscreen busca as chaves **antes da primeira requisição de mídia**, importa e descriptografa; (6) `flavor-guard` ganha a verificação `FORBIDDEN_AES128_IN_PUBLIC` (marcador `VD_AES128_LOCAL_ONLY` presente nos módulos reais).

**Justificativa:** a fronteira "só no `local`" vira propriedade do build (código ausente), não de um `if` em tempo de execução; o núcleo continua puro; a segurança reaproveita o fluxo de recusa já revisado.

**Desvio do padrão existente:** um mecanismo de flavor para módulos que não são providers (módulos virtuais novos), coberto pelo precedente do ADR-0011 (flavor por módulo) e pela decisão de escopo desta spec (só `local` por ora).

**Alternativas descartadas:** `if (flavor === 'local')` em tempo de execução (o código iria no zip da loja); entregar os bytes da chave ao service worker e ao estado do job (amplia onde o segredo vive); biblioteca de AES em JS (WebCrypto basta).

**ADRs:** ADR-0015, ADR-0013, ADR-0011, ADR-0008, ADR-0006, ADR-0001.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** descriptografia por segmento em memória (WebCrypto é nativo e rápido); no máximo 8 chaves distintas por playlist; leitura da chave limitada a 64 bytes e 10 s; o limite de memória existente (1,5 GiB vídeo; 512 MiB com junção de áudio) continua valendo sobre o texto cifrado.
- **Segurança:** allowlist estrita e fail-closed; só `AES-128` + `KEYFORMAT` ausente ou `identity`; chave só da URI da playlist; sem chave ⇒ nenhuma requisição de mídia; validação de sanidade do texto claro (sync byte `0x47` em TS; caixa `ftyp/styp/moof/sidx/moov` em fMP4) impede entregar lixo com chave errada; `sinf/schm` no init ainda recusa (CENC dentro de AES-128).
- **Privacidade e dados pessoais:** bytes da chave, URI da chave e tokens **nunca** em logs, diagnósticos, estado do job (`storage.session`), erros, mensagens entre contextos ou console; `CryptoKey` não extraível; buffer bruto zerado após o import; plano só carrega URLs/IV.
- **Disponibilidade e resiliência:** falha de chave ⇒ `failed` `KEY_FAILED` sem baixar segmentos; texto claro inválido ⇒ `DECRYPT_FAILED`; cancelar descarta chaves; a escada 401/403 da SPEC-0016 vale para a busca da chave.
- **Acessibilidade (UI):** um `p.status` novo; axe sem violações sérias no E2E-01.
- **Custo:** N/A.
- **Conformidade:** ADR-0015 regra 6 — README e runbook trazem o aviso de uso responsável.

## 6. Artefato A — Contrato
**Interface:** `KeyPolicyPort` (src/core/ports); `HlsInfo.aes128?`; `EncryptionPlan` e `start.encryption`/`audio.encryption` (src/core/hls-download/protocol.ts); `JobError` `KEY_FAILED`/`DECRYPT_FAILED`; `src/aes128/**`; módulos virtuais.

```text
// ---- Política de chave (injetada; ausente no flavor public) ----
interface KeyPolicyPort {
  classify(playlistText: string, baseUrl: string): KeyVerdict
}
type KeyVerdict =
  | { kind: 'none' }                                   // nenhuma chave ou só METHOD=NONE
  | { kind: 'aes128'; plan: EncryptionPlan }           // todas as chaves são AES-128 válidas
  | { kind: 'protected' }                              // qualquer outra coisa (fail-closed)

// Allowlist (METHOD/atributos EXATOS, sensível a maiúsculas, CRLF tolerado, sem tokenização ambígua):
//  - #EXT-X-KEY:METHOD=NONE  (reseta a chave dos segmentos seguintes)
//  - #EXT-X-KEY:METHOD=AES-128,URI="<http(s) absoluta ou relativa>"[,IV=0x<32 hex>][,KEYFORMAT="identity"][,KEYFORMATVERSIONS="1"]
//  - #EXT-X-SESSION-KEY (master): só informativo; aceito apenas se for AES-128 válido; a decisão vem das tags da playlist de mídia.
//  Atributos fora de {METHOD,URI,IV,KEYFORMAT,KEYFORMATVERSIONS}, repetidos, URI não-http(s) após resolver, IV malformado,
//  METHOD diferente (SAMPLE-AES, SAMPLE-AES-CTR...), KEYFORMAT != identity, #EXT-X-FAXS-CM, mais de 8 chaves
//  distintas, ou qualquer dúvida de parse => { kind: 'protected' }.

// ---- Plano ----
interface EncryptionKey { url: string; iv?: string }    // iv = 32 hex minúsculos explícito (sem 0x)
interface EncryptionPlan {
  keys: EncryptionKey[]                  // 1..8, URLs absolutas http(s)
  segmentKeys: (number | null)[]         // por segmento: índice em keys, ou null (claro); mesmo tamanho de urls
  initKey?: number | null                // init (EXT-X-MAP): índice ou null; chave de init exige IV explícito
  mediaSequence: number                  // EXT-X-MEDIA-SEQUENCE (padrão 0); IV padrão do segmento i = big-endian128(mediaSequence + i)
}

// ---- Dados (aditivos) ----
HlsInfo.aes128?: true                    // só no local, quando todas as chaves são AES-128 válidas; então encrypted === false
// No public (sem porta): comportamento atual: qualquer tag fora de METHOD=NONE => encrypted === true.
OffscreenStart.encryption?: EncryptionPlan                  // vídeo/trilha principal
OffscreenAudio.encryption?: EncryptionPlan                  // trilha de áudio separada (SPEC-0014)
JobError += 'KEY_FAILED' | 'DECRYPT_FAILED'                 // i18n: jobErrorKEY_FAILED / jobErrorDECRYPT_FAILED (pt_BR, en)

// ---- Serviço (downloadHls) — ordem de recusa inalterada, com um ramo novo ----
// drm/encrypted/live/unresolved como hoje; ao re-analisar a playlist (vídeo e áudio) com a porta presente:
//   kind 'aes128'   => segue, anexando o plano ao start; kind 'protected' => ENCRYPTED, sem requisição de mídia/chave.
//   init criptografado sem IV explícito, ou chave que cobre segmento fMP4 sem MAP utilizável => HLS_NOT_RESOLVED.

// ---- Offscreen (run-job) ----
//  1) buscar TODAS as chaves (fetchBytes + escada SPEC-0016), cada resposta com exatamente 16 bytes, senão failed KEY_FAILED
//     antes de qualquer requisição de mídia; 2) importKey(raw, 'AES-CBC', extractable:false); zerar o buffer bruto;
//  3) para cada segmento/init/range: decrypt({name:'AES-CBC', iv}, key, bytes) (PKCS7); tamanho não múltiplo de 16 ou
//     padding inválido => failed DECRYPT_FAILED; 4) sanidade do texto claro (TS: 0x47 no 1º byte; fMP4: caixa conhecida) ou DECRYPT_FAILED;
//  5) seguir a montagem (assembleTs / assembleFmp4 / assembleMerged); 6) descartar as CryptoKey ao fim ou cancelar.
// Com byte range: cada sub-intervalo buscado é descriptografado como um segmento, com o IV do seu segmento.

// ---- Build ----
// virtual:aes128-policy (background) e virtual:aes128-decrypt (offscreen): local => src/aes128 real; public => stub.
// Módulos reais contêm o marcador VD_AES128_LOCAL_ONLY; flavor-guard falha com FORBIDDEN_AES128_IN_PUBLIC se aparecer no zip public.
// dependency-cruiser: src/core não importa src/aes128; só background/offscreen importam os módulos virtuais.

// ---- Popup ----
// local + hls.aes128: sem badge-encrypted; mostra p[data-testid=aes128-note] (i18n aes128Note) e o botão de baixar.
// public ou protected: badge-encrypted como hoje, sem botão.
```

**Design:** só o texto novo `aes128Note` ("Criptografado (AES-128): será descriptografado com a chave da sua sessão") no cartão HLS existente; sem tela nova.

**Arquivos/módulos afetados:** ver `touches`; novos: `src/aes128/**`, `scripts/build/aes128-plugin.ts`, regra e teste de arquitetura, extensão do `flavor-guard`, fixtures `e2e/fixtures/hls/aes128/**`; docs `README.md` e `docs/runbook.md`.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Allowlist de chave | tags válidas e inválidas (fuzz) | só o formato permitido vira `aes128`; resto `protected` | UT-01 |
| Plano de chaves | rotação, IV explícito/derivado, sequência, init | `EncryptionPlan` correto; init sem IV recusado; >8 chaves protegido | UT-02 |
| Descriptografia | segmentos TS/fMP4, ranges, chave errada | texto claro correto / `DECRYPT_FAILED` | UT-03 |
| Manuseio da chave | resposta de chave, estado, erros | 16 bytes; `CryptoKey` não extraível; nada serializável | UT-04 |
| Comando `start` | `encryption` válido/inválido | aceito / rejeitado | UT-05 |
| Texto no popup | aes128 / protegido / public | nota / badge de protegido | UT-06, E2E-01..03 |
| Download AES-128 (TS) | playlist TS cifrada + chave | job `done`; MP4 válido | IT-01, E2E-01 |
| Download AES-128 (fMP4 + range) | IV por sequência | job `done` | IT-02 |
| Rotação de chave | 2 chaves com IV explícito | job `done` | IT-03 |
| Recusas no local | SAMPLE-AES, KEYFORMAT DRM, FAXS-CM, atributo estranho, URI ruim, chave 404/tamanho errado | `ENCRYPTED` ou `KEY_FAILED`; nenhuma mídia baixada | IT-04, E2E-03 |
| Flavor público | playlist AES-128 | `ENCRYPTED`; nenhuma requisição de chave nem de mídia | IT-05, E2E-02 |
| Privacidade | chave, URI de chave, tokens | ausentes de logs, estado, erros, console, mensagens | IT-06 |
| Contexto na chave | CDN da chave exige Origin/Referer | busca com contexto, depois ok | IT-07 |
| Resolve | master AES-128 no local / no público / DRM na página | `aes128` baixável / protegido / `drm` vence | IT-08 |
| Build | zips dos dois flavors | sem código real no public; `flavor-guard` falha se houver | IT-09, UT-07 |
| Compatibilidade | payloads sem campos novos | continuam válidos | CT-01 |

## 7. Artefato B — Plano de Testes (TDD)

### 7.1 Testes de Caracterização
N/A — a allowlist atual e o `badge-encrypted` já são cobertos pelos testes das SPEC-0011/0012/0014/0015; IT-05 e E2E-02 fixam que o `public` não muda (guarda: passa antes da mudança).

### 7.2 Testes Unitários
- **UT-01** — Dado dezenas de linhas de chave (válidas e hostis: `METHOD` em minúsculas/aspas/espaços, `SAMPLE-AES`, `KEYFORMAT` de Widevine/FairPlay, atributo desconhecido, atributo repetido, `IV` com 31/33 hex ou sem `0x`, `URI` relativa/absoluta/`javascript:`/`data:`/`file:`, `METHOD=NONE` dentro de `URI` entre aspas, `\r\n`, U+2028, tag de chave depois dos segmentos, `#EXT-X-FAXS-CM`, `SESSION-KEY` AES-128 e não-AES, mais de 8 chaves), quando `classify` roda, então só o formato da allowlist devolve `aes128` e todo o resto devolve `protected`; sem a porta, `hasEncryptedKey` segue marcando tudo fora de `METHOD=NONE` como criptografado.
- **UT-02** — Dado playlists com uma chave, rotação (KEY A, KEY B, `METHOD=NONE`), `EXT-X-MEDIA-SEQUENCE` ausente/explícito, IV explícito e ausente, e `EXT-X-MAP` após KEY com e sem IV, quando o plano é montado, então `segmentKeys`/`initKey`/`mediaSequence` e os IV derivados (big-endian de 128 bits de `mediaSequence + i`) estão corretos, e init cifrado sem IV explícito é recusado.
- **UT-03** — Dado texto cifrado gerado com `node:crypto` (AES-128-CBC, PKCS7), quando `decryptSegment` roda com a chave e o IV certos, errados, com tamanho não múltiplo de 16 e com padding inválido, então devolve o texto claro ou lança `DECRYPT_FAILED`; e a sanidade rejeita texto claro TS sem `0x47` e fMP4 sem caixa conhecida.
- **UT-04** — Dado respostas de chave com 0, 15, 16, 17 e 64+ bytes, quando a chave é carregada, então só 16 bytes são aceitos, a `CryptoKey` é não extraível, o buffer bruto é zerado e nenhum objeto serializável (estado do job, erro, log) contém a chave.
- **UT-05** — Dado comandos `start` com `encryption` válido, com índice fora de `keys`, com `segmentKeys` de tamanho diferente de `urls`, com mais de 8 chaves, URL não-http(s) e IV malformado, quando `isCommand` valida, então aceita só o válido (também em `audio.encryption`).
- **UT-06** — Dado `hls` com `aes128`, `encrypted`, e sem nenhum dos dois, quando o texto do cartão é calculado, então mostra a nota AES-128, o badge de protegido e nada, respectivamente; as chaves i18n `aes128Note`, `jobErrorKEY_FAILED` e `jobErrorDECRYPT_FAILED` existem em pt_BR e en.
- **UT-07** — Dado os módulos reais de `src/aes128/**`, quando inspecionados, então todos contêm o marcador `VD_AES128_LOCAL_ONLY`, e o stub do `public` não contém `AES-CBC`, `decrypt` nem o marcador.

### 7.3 Testes de Integração
- **IT-01** — Dado servidor com playlist TS cifrada em AES-128 (segmentos cifrados com `node:crypto`/`ffmpeg`, IV por sequência) e a chave em URL própria, quando o job roda (política presente), então termina `done`, o MP4 é válido (`inspectMp4`) e a chave foi pedida antes do primeiro segmento.
- **IT-02** — Dado fMP4 de arquivo único com byte range, cifrado em AES-128 com IV por sequência, quando o job roda, então termina `done` e o resultado reproduz o MP4 de referência sem criptografia.
- **IT-03** — Dado playlist com duas chaves e IV explícitos (rotação), quando o job roda, então termina `done`.
- **IT-04** — Dado, no flavor `local`, playlists com `SAMPLE-AES`, `KEYFORMAT` de DRM, `FAXS-CM`, atributo desconhecido, `URI` não-http(s), chave com 404, e chave com 15 bytes, quando `download` roda, então responde `ENCRYPTED` (ou o job termina `KEY_FAILED`) e o servidor não recebe nenhuma requisição de segmento.
- **IT-05** — Dado o mesmo cenário de AES-128 válido com a política **ausente** (flavor `public`), quando `resolveHls` e `download` rodam, então o candidato fica `encrypted`, `download` responde `ENCRYPTED` e o servidor não recebe requisição de chave nem de mídia (guarda: passa antes da mudança).
- **IT-06** — Dado chave e segmentos com tokens na URL, quando o job conclui, falha e é cancelado, então nem a chave, nem a URI da chave, nem os tokens aparecem em diagnósticos, console, estado do job, erros ou mensagens enviadas pelo service worker.
- **IT-07** — Dado host de chave que responde 403 sem `Origin`/`Referer` do iniciador, quando o job roda, então a escada da SPEC-0016 recupera a chave e o job termina `done`.
- **IT-08** — Dado master AES-128 (`SESSION-KEY`), quando `resolveHls` roda com a política (local), sem a política (public) e com `protection: 'drm'` vindo do DOM, então o candidato fica baixável (`aes128`), protegido e `drm`, respectivamente.
- **IT-09** — Dado os builds `local` e `public`, quando os zips são inspecionados, então o `local` contém o marcador e o `public` não contém o marcador nem o chunk real; e `flavor-guard` falha com `FORBIDDEN_AES128_IN_PUBLIC` num zip `public` que contenha o marcador.

### 7.4 Testes de Contrato
- **CT-01** — Dado `HlsInfo`, `start`, `audio` e `JobError` sem os campos novos (SPEC-0011@1, SPEC-0012@1, SPEC-0013@1, SPEC-0014@1), quando validados, então continuam aceitos; com os campos novos válidos, também; com `aes128: false` ou `encrypted: true` junto com `aes128: true`, rejeitados.

### 7.5 Testes E2E
- **E2E-01** — Dado uma página com HLS AES-128 gerado com `ffmpeg -hls_key_info_file` e a chave servida pelo servidor de fixture [jornada: baixar-hls], quando o usuário (flavor `local`) abre o popup, então o cartão mostra a nota AES-128 e o botão de baixar, o download termina e o MP4 salvo é válido (vídeo 320×180, duração ±0,6 s) em < 10 s; axe sem violações sérias; `ffprobe` do arquivo como evidência manual.
- **E2E-02** — Dado a mesma página no flavor `public`, quando o popup abre, então aparece `badge-encrypted` e não há botão de baixar.
- **E2E-03** — Dado playlist com `KEYFORMAT="urn:uuid:…"` (Widevine) no flavor `local`, quando o popup abre, então aparece `badge-encrypted`, sem botão, e o servidor não recebe requisição de chave.

### 7.6 Outros
- **Segurança:** fuzz da allowlist (UT-01) com semente fixa mais um conjunto de regressão; revisão manual pelo Reviewer dos pontos "dúvida ⇒ protegido".
- **Manual (G6):** o usuário testa uma aula real na rc.

**Dublês e dados de teste:** fixtures `e2e/fixtures/hls/aes128/**` (chave de teste fixa e IV conhecidos, gerados por `ffmpeg -hls_key_info_file`, comando em `generate-video.sh`); helper de cifra com `node:crypto` nos testes; servidor de playlists com rota de chave.

**Ambiente de execução:** Vitest e Playwright com Chromium real, nos dois flavors, local e no CI.

## 8. Plano de Rollout
- **Estratégia:** deploy direto na próxima rc; funcionalidade só no `local` (ausente do `public` por construção).
- **Dados/schema:** N/A.
- **Compatibilidade:** campos aditivos; sem a porta o comportamento é o de hoje.
- **Observabilidade:** logs `hls.aes128` (sim/não) e `job.failed` com código (`KEY_FAILED`/`DECRYPT_FAILED`), sem URL/chave.
- **Rollback:** reverter o PR e publicar nova rc.
- **Etapas de migração/coexistência:** N/A.
- **Fase 1 (portão):** IT-01 prova a descriptografia ponta a ponta com fixture real; `flavor-guard`/IT-09 provam a ausência no `public` antes de seguir.

## 9. Questões em Aberto
Nenhuma. (Premissas a confirmar no H1: segmentos/init descriptografados inteiros em memória; sanidade do texto claro obrigatória; `SESSION-KEY` da master só informativa; legendas e I-frames ficam de fora.)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN, após a aprovação. Cada fase começa pelos testes. -->
**Fase 1: Política de chave, plano e descriptografia (núcleo)**
- [ ] Red: UT-01..UT-07, CT-01 com a tag `SPEC-0017:<ID>` (fuzz da allowlist, plano de chaves, descriptografia, manuseio da chave)
- [ ] Green: `src/aes128/**` (classify, plano, decrypt), porta `KeyPolicyPort`, módulos virtuais e plugin de build, `flavor-guard` com `FORBIDDEN_AES128_IN_PUBLIC`
- [ ] Refactor e validar: build + suíte + arquitetura (G2/G3)

**Fase 2: Download ponta a ponta**
- [ ] Red: IT-01..IT-09 (TS, fMP4 com range, rotação, recusas, privacidade, contexto na chave, resolve, build)
- [ ] Green: `start.encryption`/`audio.encryption`, busca de chaves no offscreen antes da mídia, `KEY_FAILED`/`DECRYPT_FAILED`, popup (`aes128-note`)

**Fase 3: Jornada E2E e documentação**
- [ ] Red: E2E-01..E2E-03 (fixture AES-128 gerada com ffmpeg)
- [ ] Green: jornada completa nos dois flavors, 3 execuções sem flake; README e runbook com o uso responsável

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Release rc com smoke/E2E no pipeline e teste manual do Thomas (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)


## 12. Registro de Gates
<!-- Status: PENDING | PASS | FAIL | N/A. PASS e N/A exigem evidência (comando + resultado, SHA, execução de CI, veredito). -->
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — 0dadeb8 (árvore suja) | 2026-10-03 |
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
<!-- Mudança em spec aprovada: uma linha por emenda. Mudou o contrato? Incremente `contract_version` e rode `spec_graph.py impacted SPEC-0017`. -->
| Versão do contrato | Data | Mudança | Motivo | Specs impactadas | Aprovado por |
|---|---|---|---|---|---|
