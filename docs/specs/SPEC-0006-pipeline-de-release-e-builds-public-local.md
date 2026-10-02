---
id: SPEC-0006
title: Pipeline de release e builds public/local
tier: full
type: foundation
user_facing: false
status: in-progress
created: 2026-09-30
parent: SPEC-0001
depends_on: [SPEC-0004]
consumes_contract: [SPEC-0005@1]
contract_version: 1
touches: [tsconfig.json, vitest.config.ts, tests/fixtures/providers/release-*/**, .github/workflows/release.yml, scripts/release/**, tests/release/**, docs/privacy-policy.md, docs/runbook.md, docs/store-listing/**]
adrs: [ADR-0010, ADR-0011, ADR-0004, ADR-0006]
external: []
size: M
approved_by: thomas
approved_at: 2026-09-30
---

# SPEC-0006 — Pipeline de release e builds public/local

## 1. Visão Geral
Uma tag SemVer (`vX.Y.Z` ou `vX.Y.Z-rc.N`) dispara o workflow de release: valida que a versão da tag bate com `package.json`, builda os dois flavors, verifica que o build `public` não contém provider `local`, roda o E2E contra os zips gerados (smoke), cria a GitHub Release com `extension-local-X.Y.Z.zip` e `extension-public-X.Y.Z.zip` e, após aprovação no environment `webstore`, envia o `public` para a Chrome Web Store pela API (rc → listagem não listada; estável → listagem pública).

## 2. Motivação & Escopo
**Motivação:** "nada é publicado fora do pipeline" (ADR-0004) e a garantia verificável de que a loja nunca recebe código proibido (ADR-0011).

**Objetivos (dentro do escopo):**
- `release.yml` por tag, com jobs `verify-version`, `build`, `flavor-guard`, `smoke`, `github-release`, `webstore` (environment `webstore` com aprovação obrigatória do Thomas).
- `scripts/release/`: checagem de versão, inspeção de bundle (`flavor-guard`), cliente mínimo da Chrome Web Store API **v2** (upload + publish, com `publishType` `STAGED_PUBLISH` para rc e `DEFAULT_PUBLISH` para estável).
- Política de privacidade (`docs/privacy-policy.md`, pt-BR/en) e textos/capturas da listagem (`docs/store-listing/`), com a declaração de uso para conteúdo que o usuário tem direito de baixar e sem DRM.
- Runbook de release e rollback (`docs/runbook.md`).
- `deploy_staging`, `deploy_production` e `smoke_test` no sdd-config.

**Não-objetivos (fora do escopo):**
- Criação da conta de desenvolvedor da Web Store e do projeto OAuth no Google Cloud (ação do Thomas — pré-requisito externo).
- Atualização automática do build `local` (usuário reinstala o zip).

## 3. Dependências
- **Implementações necessárias:** SPEC-0004 — CI e ruleset (a release só roda a partir de commit verde na `main`).
- **Contratos consumidos:** SPEC-0005@1 — `ProviderManifest` (`provider.json` com `flavors`) e `PROVIDERS_EXTRA_DIR` para o `flavor-guard`.
- **Pré-requisitos externos:** conta de desenvolvedor da Chrome Web Store (Thomas vai criar); item criado na loja (primeiro upload manual exigido pela loja, se ainda for o caso); credenciais OAuth (`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`; API v2 exige o `publisherId`, e o escopo `https://www.googleapis.com/auth/chromewebstore`) como secrets do environment `webstore`.

## 4. Decisão Arquitetural
**Contexto:** Projeto novo; ADR-0004 (entrega), ADR-0011 (flavors), ADR-0006 (segredos).

**Decisão:** GitHub Actions por tag + GitHub Releases para o `local` + Chrome Web Store API para o `public`; scripts em TypeScript executados pelo próprio Node 24 (remoção nativa de tipos, sem `tsx` nem nova dependência), testados por Vitest.

**Justificativa:** mesma plataforma do CI, publicação reproduzível e segredos só no environment protegido.

**Desvio do padrão existente:** Nenhum.

**Alternativas descartadas:** action de terceiros para publicar na loja (mais uma dependência com acesso aos segredos); upload manual (ADR-0004).

**ADRs:** ADR-0010, ADR-0011, ADR-0004, ADR-0006.

## 5. Requisitos Não-Funcionais
- **Desempenho e escala:** N/A — execução por tag.
- **Segurança:** secrets só no job `webstore`, com `environment: webstore` e aprovação; `GITHUB_TOKEN` com `contents: write` só no job `github-release`; secrets nunca impressos (teste de mascaramento UT-03).
- **Privacidade e dados pessoais:** política de privacidade publicada declarando que nada é coletado ou transmitido (exigência da loja) — revisada no G4.
- **Disponibilidade e resiliência:** falha no upload à loja não apaga a GitHub Release; job reexecutável manualmente para a mesma tag (idempotente: upload da mesma versão já enviada → mensagem clara, sem erro silencioso) — UT-02.
- **Acessibilidade (UI):** N/A — sem UI.
- **Custo:** taxa única de US$ 5 da conta de desenvolvedor (pilar custo dispensado).

## 6. Artefato A — Contrato
**Interface:** `tag git → release.yml` · `scripts/release/*`

```text
Gatilho: push de tag v<semver>
  verify-version : tag (sem 'v') == package.json#version, senão falha "VERSION_MISMATCH"
  build          : pnpm build → .output/chrome-mv3-{public,local} → zips
  flavor-guard   : falha "FORBIDDEN_PROVIDER_IN_PUBLIC:<id>" se o bundle public contiver id de provider
                   cujo provider.json não inclui 'public'
  smoke          : pnpm test:e2e contra os zips gerados (os dois flavors)
  github-release : cria Release (prerelease se -rc.N) com extension-{public,local}-X.Y.Z.zip
  webstore       : (aprovação no environment) upload do zip public;
                   rc → publishType=STAGED_PUBLISH (aprovado na revisão e mantido em staging, sem ir ao público); estável → publishType=DEFAULT_PUBLISH (publica ao aprovar)
                   erros da API → falha com código/mensagem da API, sem expor segredos

scripts/release/webstore.ts:
  upload(zip, creds)  → POST https://chromewebstore.googleapis.com/upload/v2/publishers/{publisherId}/items/{itemId}:upload (corpo = zip; Bearer) → { uploadState: 'SUCCEEDED' | 'IN_PROGRESS' | 'FAILED', crxVersion } ; IN_PROGRESS → consulta `:fetchStatus` (GET v2/publishers/{p}/items/{i}:fetchStatus, campo lastAsyncUploadState) até SUCCEEDED/FAILED ou timeout
  publish(type, creds) → POST https://chromewebstore.googleapis.com/v2/publishers/{p}/items/{i}:publish com { publishType: 'STAGED_PUBLISH' | 'DEFAULT_PUBLISH' } → { state: 'PENDING_REVIEW' | 'STAGED' | 'PUBLISHED' | 'PUBLISHED_TO_TESTERS' | ... } (REJECTED/CANCELLED → falha)
```

**Design:** N/A — sem interface.

**Arquivos/módulos afetados:** ver `touches` no frontmatter.

### 6.1 Mapa de Comportamentos
| Cenário | Condição / Entrada | Resultado esperado | Testes |
|---|---|---|---|
| Versão coerente | tag `v0.1.0`, package `0.1.0` | segue | UT-01 |
| Versão divergente | tag `v0.1.1`, package `0.1.0` | falha `VERSION_MISMATCH` | UT-01 |
| Diretório de provider sem manifesto / nenhum manifesto / id por token / `.map` e caminho de provider no bundle público | provider sem `provider.json`; zero manifestos; id colado em outra palavra; `.map` no zip | falha fechada (`INVALID_PROVIDER_MANIFEST`, `NO_PROVIDERS_FOUND`, `FORBIDDEN_PROVIDER_IN_PUBLIC`) e sem falso positivo por id parcial | IT-01, CT-01 |
| Provider proibido no public | provider-fixture `local` injetado | falha `FORBIDDEN_PROVIDER_IN_PUBLIC` | CT-01, IT-01 |
| Build limpo | só `generic` | guard passa; zips gerados e anexados à Release | IT-01, IT-02 |
| rc vs estável | `-rc.1` / sem sufixo | `STAGED_PUBLISH` / `DEFAULT_PUBLISH`; Release prerelease ou não | UT-02 |
| API da loja falha | resposta `FAILURE` / 4xx | job falha com mensagem da API | UT-02 |
| Segredo em log | erro contendo refresh token | valor mascarado na saída | UT-03 |

## 7. Artefato B — Plano de Testes (TDD)
### 7.1 Testes de Caracterização
- N/A — projeto novo.

### 7.2 Testes Unitários
- **UT-01** — Dado pares (tag, versão do package.json), quando `verifyVersion` é chamado, então aceita iguais (inclusive `-rc.N`) e falha com `VERSION_MISMATCH` nos demais.
- **UT-02** — Dado respostas simuladas da Chrome Web Store API v2 (upload `SUCCEEDED`, `FAILED`, `IN_PROGRESS` seguido de `fetchStatus`, 401, versão já enviada; publish `PENDING_REVIEW`/`STAGED`/`PUBLISHED`/`REJECTED`), quando `upload`/`publish` rodam, então escolhem `STAGED_PUBLISH` para rc e `DEFAULT_PUBLISH` para estável e falham com a mensagem da API nos erros.
- **UT-03** — Dado um erro cuja mensagem contém o valor do refresh token, quando o logger de release formata a saída, então o valor aparece como `***`.

### 7.3 Testes de Integração
- **IT-01** — Com `pnpm build` real e `PROVIDERS_EXTRA_DIR` apontando para um provider-fixture `flavors:[local]`, o `flavor-guard` sobre `.output/chrome-mv3-public` falha com `FORBIDDEN_PROVIDER_IN_PUBLIC:<id>`; sem o fixture, passa.
  Endurecimento (Emenda 2): (c) diretório de provider sem `provider.json` → `INVALID_PROVIDER_MANIFEST` (falha fechada); (d) `providersDir` configurado (ex.: `src/providers` existente) sem nenhum manifesto → `NO_PROVIDERS_FOUND`; (e) o id só conta como vazamento quando aparece como token inteiro (sem letras, dígitos, `_` ou `-` colados), e o manifesto exige `id` com `^[a-z][a-z0-9-]{2,}$`; (f) o bundle público com arquivo `.map` ou com o caminho `src/providers/<diretório de provider que não inclui public>` → `FORBIDDEN_PROVIDER_IN_PUBLIC:<id>`.
- **IT-02** — Com uma tag `v0.0.0-rc.1` num fork/branch de teste no GitHub, o workflow gera a Release prerelease com os dois zips e o job `webstore` fica aguardando aprovação (evidência: link da execução).

### 7.4 Testes de Contrato
- **CT-01** — Consome SPEC-0005@1: o `flavor-guard` lê `provider.json` com o schema do contrato (`id`, `flavors`) e usa `PROVIDERS_EXTRA_DIR` conforme definido; se o schema mudar (campo renomeado), o teste falha. O `id` inválido por formato (curto demais, maiúsculas, espaços) também é rejeitado (Emenda 2).

### 7.5 Testes E2E
- N/A — user_facing: false (o smoke da release executa o E2E de SPEC-0005 contra os zips).

### 7.6 Outros
- N/A

**Dublês e dados de teste:** servidor HTTP local simulando os endpoints da Chrome Web Store API (UT-02); provider-fixture de SPEC-0005; credenciais fictícias.

**Ambiente de execução:** UT/IT-01 local e no CI; IT-02 no GitHub Actions do repositório.

## 8. Plano de Rollout
- **Estratégia:** `v0.1.0-rc.1` → submissão `STAGED_PUBLISH` (staging, G6: revisão aprovada, nada público) + zips do rc na GitHub Release prerelease para o Thomas testar instalando sem empacotar → confirmação humana → `v0.1.0` com `DEFAULT_PUBLISH` (produção).
- **Dados/schema:** N/A
- **Compatibilidade:** versão da loja sempre crescente; `version_name` exibe o SemVer com sufixo rc.
- **Observabilidade:** notificação de falha do workflow; status da revisão acompanhado no Developer Dashboard; runbook em `docs/runbook.md`.
- **Rollback:** nova tag `vX.Y.(Z+1)` a partir do commit da versão anterior boa, publicada pela mesma pipeline; build `local`: reinstalar o zip da Release anterior.
- **Etapas de migração/coexistência:** N/A

## 9. Questões em Aberto
- [x] Conta de desenvolvedor da Web Store — Thomas vai criar; enquanto não existir, o job `webstore` fica bloqueado por impedimento externo e a produção é só o zip `local` na GitHub Release (Thomas, 2026-09-30)
- [x] Nome da listagem — provisório "Video Downloader"; nome final definido antes da primeira publicação estável, em `docs/store-listing/` (Thomas, 2026-09-30)

## 10. Aprovação (H1)
Registrada no frontmatter (`approved_by`, `approved_at`) somente depois que o humano responder "Aprovado". O arquiteto nunca aprova a própria spec.

## 11. Checklist de Implementação
<!-- Preenchido na fase PLAN. -->

**Fase 1: Scripts de release**
- [ ] Red: escrever UT-01, UT-02, UT-03 com a tag `SPEC-0006:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 2: Flavor guard**
- [ ] Red: escrever IT-01, CT-01 com a tag `SPEC-0006:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase 3: Workflow de release**
- [ ] Red: escrever IT-02 com a tag `SPEC-0006:<ID>` e confirmar que falham pelo motivo certo
- [ ] Green: implementar o mínimo para passar, seguindo os ADRs citados
- [ ] Refactor mantendo tudo verde
- [ ] Validar: build + suíte completa + arquitetura (G2/G3)

**Fase final: Integração, entrega e documentação**
- [ ] Review independente (G4)
- [ ] Integração + CI verde (G5) e aprovação (H2)
- [ ] Deploy via pipeline: `v0.1.0-rc.1` (staging) → confirmação do Thomas → `v0.1.0` (produção) (G6)
- [ ] Relatório de Entrega, docs raiz e CHANGELOG (G7)

## 12. Registro de Gates
| Gate | Status | Evidência | Data |
|---|---|---|---|
| G0 Spec | PASS | validate: 0 erro(s) — ? | 2026-09-30 |
| G1 Red | PASS | verify G1: PASS; `pnpm test` exit 1 (red: ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[42/71]⎯) — 127ef64 | 2026-09-30 |
| G2 Green | PASS | build exit 0 (✔ Finished in 166 ms); test exit 0 (Duration  17.99s (tests 98%, import 1%)); lint exit 0 (✔ Finished in 128 ms); coverage exit 0 (================================================================================) — 6663870 | 2026-09-30 |
| G3 Arquitetura | PASS | arch_test exit 0 (✔ no dependency violations found (3 modules, 0 dependencies cruised)) — 6663870 | 2026-09-30 |
| G4 Review | FAIL | reviewer-agent ab7e7390: CHANGES_REQUESTED @ 6663870 — 1 major (runbook: rollback não funciona) + 7 minor (flavor-guard fail-open e match frouxo, smoke sem asserção de não-rebuild, redact inconsistente, docs vs manifest, fetch redundante, re-run do webstore) | 2026-09-30 |
| G5 Integração & CI | PENDING | | |
| H2 Integração aprovada | PENDING | | |
| G6 Deploy | PENDING | | |
| G7 Pronto & Docs | PENDING | | |

## 13. Registro de Impedimentos
| ID | Aberto em | Fase/Gate | Tipo | Descrição | Tentativas | Responsável | Resolução | Fechado em |
|---|---|---|---|---|---|---|---|---|
| IMP-01 | 2026-09-30 | G1 | spec | Contrato da Chrome Web Store API baseado na v1.1 (publishTarget trustedTesters, uploadState FAILURE, sem publisherId); a API vigente é a v2 (docs oficiais: v1 arquivada desde out/2025): upload POST /upload/v2/publishers/{p}/items/{i}:upload com uploadState SUCCEEDED\|IN_PROGRESS\|FAILED; publish com publishType DEFAULT_PUBLISH\|STAGED_PUBLISH; exige publisherId | Consulta à documentação oficial e ao discovery document v2 (2026-09-30) | Architect (emenda; ratificação do Thomas no H2) | Emenda 1 (API) — cliente Web Store v2; ratificação no H2 da onda 3 | 2026-09-30 |
| IMP-02 | 2026-10-02 | G2 | trabalho | TEST_DEFECT: providersWithFixture() em tests/release/flavor-guard.test.ts cria not-a-provider/readme.txt (subdiretório sem provider.json) e espera que seja ignorado, contradizendo a Emenda 2 (falha fechada: INVALID_PROVIDER_MANIFEST) e os testes de endurecimento | Implementer implementou o endurecimento (patch no scratchpad) e passa todos os testes novos; só os 4 testes antigos que usam o helper falham | Test-writer (remover not-a-provider/readme.txt do helper) |  |  |

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
| 1 (escopo) | 2026-09-30 | `touches` inclui `tsconfig.json` (incluir `scripts/`) e `vitest.config.ts` (incluir `tests/release/**`); scripts executados com Node 24 nativo em vez de `tsx` | o harness da SPEC-0003 só enxerga os diretórios que já existiam; evita uma dependência fora dos ADRs | SPEC-0005 (nenhuma: arquivos distintos) | pendente de ratificação do Thomas no H2 da onda 3 |
| 1 (API) | 2026-09-30 | cliente da Chrome Web Store passa da API v1.1 para a v2 (`publisherId`, `uploadState SUCCEEDED/IN_PROGRESS/FAILED`, `publishType STAGED_PUBLISH/DEFAULT_PUBLISH`; rc = staged, estável = default); novo secret `CWS_PUBLISHER_ID`; `touches` inclui `tests/fixtures/providers/release-*/**` | a documentação oficial (developer.chrome.com/docs/webstore/api, consultada em 2026-09-30) declara a v2 vigente e a v1 arquivada desde out/2025; `trustedTesters` não existe na v2 | ADR-0004 (texto do staging) | pendente de ratificação do Thomas no H2 da onda 3 |
| 2 (revisão) | 2026-09-30 | flavor-guard falha fechado (diretório sem manifesto, zero manifestos), id por token inteiro com formato mínimo, e rejeita `.map` e caminhos `src/providers/<local>` no bundle público; correção do procedimento de rollback no runbook; asserção de não-rebuild no smoke | achados do Reviewer (G4): o guard é a única barreira do ADR-0011 e falhava aberto; o rollback descrito não funcionava | nenhuma | pendente de ratificação do Thomas no H2 da onda 3 |
