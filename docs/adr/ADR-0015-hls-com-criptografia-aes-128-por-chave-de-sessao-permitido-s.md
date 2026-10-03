---
id: ADR-0015
title: "HLS com criptografia AES-128 por chave de sessão: permitido só no flavor local"
status: accepted
origin: decision
date: 2026-10-03
pillars: [dependencias]
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "flavor-guard (nenhum código de descriptografia no zip public) + teste de arquitetura; testes de segurança da spec que implementar a regra; allowlist de criptografia da SPEC-0011 estendida só para AES-128 + KEYFORMAT identity"
---

# ADR-0015 — HLS com criptografia AES-128 por chave de sessão: permitido só no flavor local

## Contexto e Problema
Desde o início o projeto recusa **qualquer** HLS criptografado (decisão do Thomas em 2026-10-02, ADR-0013, allowlist da SPEC-0011 e a regra do `CLAUDE.md`). O teste manual na Hotmart (2026-10-03) mostrou o caso real: a playlist master traz `#EXT-X-SESSION-KEY:METHOD=AES-128` com a chave numa URL assinada na **sessão do próprio usuário**, a mesma que o player da página usa para tocar. Esse esquema (AES-128 em segmentos, chave entregue por URI ao cliente) não é DRM no sentido técnico: não há servidor de licença, módulo de descriptografia protegido nem EME. O Thomas pediu para poder baixar o que já toca na conta dele.

Há dois impedimentos separados na Hotmart: (1) as playlists respondem **403** à busca feita pelo service worker (a CDN espera o contexto de requisição do player: `Origin`/`Referer` da página, cookies da sessão); (2) a criptografia AES-128 acima. Esta decisão trata do (2) e do contexto do (1) apenas quanto aos limites do que é aceitável.

## Direcionadores da Decisão
- Atender o uso legítimo do dono da conta (conteúdo que ele já tem acesso, uso pessoal e offline) sem virar ferramenta de contorno de proteção real.
- Manter a Chrome Web Store fora do risco: o build `public` não pode conter nada disso (ADR-0011).
- Não introduzir dependência nova (WebCrypto já existe no navegador).
- Regras verificáveis por teste, não por prosa.

## Opções Consideradas
- **A.** Manter a recusa total de HLS criptografado (status quo).
- **B.** Permitir **apenas** `METHOD=AES-128` com chave de sessão, **só no flavor `local`**, com limites explícitos.
- **C.** Permitir descriptografia em todos os flavors e em qualquer esquema de criptografia/DRM.

## Resultado da Decisão
**Opção escolhida:** "B", porque separa o que o navegador do usuário já recebe em claro para tocar (chave AES-128 por URI) do que é proteção real (DRM), mantém a loja limpa e preserva a decisão original para tudo que não seja esse caso. C foi descartada (DRM e store). A foi descartada por impedir o uso pedido pelo dono do projeto.

**Regras (verificáveis):**
1. **Só AES-128.** São aceitos `METHOD=NONE` e `METHOD=AES-128` com `KEYFORMAT` ausente ou `identity`. Continuam recusados como protegidos: `SAMPLE-AES`, `SAMPLE-AES-CTR`/CENC, qualquer `KEYFORMAT` que não seja `identity` (FairPlay `com.apple.streamingkeydelivery`, Widevine/PlayReady `urn:uuid:…`), `#EXT-X-FAXS-CM`, e qualquer página com `MediaKeys`/EME (`protection: 'drm'`).
2. **Só `flavor local`.** O código de descriptografia (e a extensão da allowlist) não existe no build `public`: `flavor-guard` e um teste de arquitetura falham se aparecer no zip `public`. No `public`, AES-128 continua "protegido".
3. **Chave só pela URI da própria playlist**, buscada com o contexto da sessão do usuário (cookies e, quando a CDN exigir, `Origin`/`Referer` da própria página/iframe em que o vídeo toca — nunca valores inventados). Proibido: adivinhar URLs, reutilizar token de outra sessão ou de outra aula, extrair chave da memória/JS do player, forçar expiração.
4. **Chave e token nunca persistem nem saem do dispositivo:** ficam só em memória do offscreen durante o job, são descartados ao fim ou ao cancelar, e nunca entram em logs, diagnósticos, estado do job, erros ou mensagens (já vale para tokens de URL; passa a valer para o material da chave).
5. **Sem dependência nova:** descriptografia com WebCrypto (`AES-CBC`, IV da playlist ou derivado da sequência de mídia, conforme RFC 8216 §5.2).
6. **Uso responsável documentado:** `README` e runbook dizem que isso é para conteúdo ao qual o usuário tem acesso, uso pessoal e offline, que os termos da plataforma podem proibir o download e que a responsabilidade é de quem usa.
7. Todas as demais recusas (ao vivo, byte range inválido, `sinf/schm` no init, limites de memória) permanecem como estão.

### Consequências
- **Boa:** resolve o caso real (Hotmart e similares com AES-128) sem tocar em DRM nem na loja.
- **Boa:** a fronteira "DRM de verdade nunca" fica explícita e testada.
- **Ruim:** a política deixa de ser "nunca baixar criptografado"; há risco de termos de uso/legal que o projeto não elimina (mitigado por flavor `local`, uso pessoal e aviso). Decisão de assumir esse risco é do Thomas.
- **Ruim:** a allowlist de segurança da SPEC-0011 passa a ter um ramo condicional por flavor; exige testes adversariais redobrados (qualquer erro de parse tem de continuar "na dúvida, protegido").

### Confirmação (G3)
Specs que implementarem esta decisão devem trazer: testes de fuzz da allowlist (nenhum esquema fora da regra 1 passa), teste de que o zip `public` não contém o código de descriptografia, teste de que chave/token não aparecem em diagnósticos, e E2E com um HLS AES-128 de fixture (chave servida localmente) no `local` e "protegido" no `public`.

## Prós e Contras das Opções
| Critério (peso) | A. Recusar tudo | B. AES-128 só no `local` | C. Tudo, todos os flavors |
|---|---|---|---|
| Atende o uso pedido (5) | 1 | 5 | 5 |
| Risco legal/loja (5) | 5 | 3 | 1 |
| Respeita "DRM de verdade nunca" (5) | 5 | 5 | 1 |
| Esforço e superfície de segurança (3) | 5 | 3 | 1 |
| **Total ponderado** | **70** | **74** | **38** |

## Mais Informações
- Evidência (2026-10-03, diagnóstico do Thomas): playlists da Hotmart respondendo 403 à busca do service worker; master com `EXT-X-SESSION-KEY:METHOD=AES-128` e chave em URL assinada da sessão.
- RFC 8216 §4.3.2.4 (`EXT-X-KEY`), §5.2 (descriptografia AES-128, IV).
- Esta decisão altera, em parte, o ADR-0013 (recusa de criptografado) e a allowlist da SPEC-0011; as specs de implementação devem registrar as emendas.
