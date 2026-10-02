# Runbook de release

Pipeline: `.github/workflows/release.yml` (SPEC-0006, ADR-0004). Nada é publicado fora dele.

## 1. Como publicar uma versão

1. Na `main` verde, abra um PR que altere `version` em `package.json` para `X.Y.Z` (estável) ou `X.Y.Z-rc.N` (candidata) e faça o merge.
2. Crie a tag **sobre o commit da `main`** e empurre:
   ```sh
   git switch main && git pull
   git tag vX.Y.Z        # ou vX.Y.Z-rc.N
   git push origin vX.Y.Z
   ```
3. Acompanhe: `gh run watch` (ou aba Actions, workflow `release`).

Fluxo recomendado: `v0.1.0-rc.1` (staging) -> testar -> `v0.1.0` (produção). Atenção: o WXT gera `version` numérico sem o sufixo (`0.1.0-rc.1` vira `version: 0.1.0` e `version_name: 0.1.0-rc.1`); se o rc foi enviado à loja, a estável seguinte deve ter número maior (ex.: `v0.1.1`), pois a loja recusa a mesma `version`. A versão da loja é sempre crescente; o rc usa o SemVer com sufixo.

### O que cada job faz

| Job | Função |
|---|---|
| `verify-version` | Tag sem o `v` igual a `package.json#version` (senão `VERSION_MISMATCH`) e commit da tag alcançável de `origin/main` |
| `build` | `pnpm build` dos dois flavors; zips com o `manifest.json` na raiz: `extension-public-<versão>.zip` e `extension-local-<versão>.zip` (artefato `release-zips`) |
| `flavor-guard` | Descompacta o zip public e falha com `FORBIDDEN_PROVIDER_IN_PUBLIC:<id>` se achar o id de um provider cujo `provider.json` não inclui `public` |
| `smoke` | Restaura os builds a partir dos zips e roda `pnpm test:e2e` nos dois flavors |
| `github-release` | `gh release create --verify-tag --generate-notes` (`--prerelease` para `-rc.N`) com os dois zips; único job com `contents: write` |
| `webstore` | Environment `webstore` (aprovação obrigatória). Envia o zip public pela Chrome Web Store API v2: rc -> `STAGED_PUBLISH`, estável -> `DEFAULT_PUBLISH` |

Se o `webstore` falhar, a GitHub Release permanece. Reexecute o job (Re-run) depois de corrigir a causa; se a loja recusar a versão como já enviada, a mensagem da API aparece no log: suba a versão (nova tag).

Execução local dos scripts (sem rede): `pnpm exec vitest run tests/release`.

## 2. Configuração inicial (uma vez)

1. **Conta de desenvolvedor** da Chrome Web Store (taxa única de US$ 5): https://chrome.google.com/webstore/devconsole. Anote o **Publisher ID** (Account).
2. **Criar o item**: faça o primeiro upload manual do zip `public` no painel (a loja exige para criar o item); preencha a listagem com `docs/store-listing/` e a política de privacidade. Anote o **Extension ID**.
3. **Google Cloud**: crie um projeto, ative a **Chrome Web Store API** (v2), configure a tela de consentimento OAuth e crie um **OAuth client ID** (tipo Desktop app). Anote `client_id` e `client_secret`.
4. **Refresh token** (escopo `https://www.googleapis.com/auth/chromewebstore`), com a conta dona do item:
   1. Abra no navegador (substitua `CLIENT_ID`):
      `https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent&redirect_uri=http://localhost&client_id=CLIENT_ID`
   2. Autorize; o navegador vai para `http://localhost/?code=...` (a página não carrega): copie o valor de `code`.
   3. Troque pelo token:
      ```sh
      curl -s https://oauth2.googleapis.com/token \
        -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
        -d code=CODE -d grant_type=authorization_code -d redirect_uri=http://localhost
      ```
   4. Guarde o campo `refresh_token` direto no secret; não o cole em issues, logs ou arquivos do repositório. Com o app OAuth em modo "Testing" o token expira em 7 dias: publique o app (ou mantenha-o "In production") para não expirar.
5. **GitHub**: Settings -> Environments -> New environment `webstore`; ative **Required reviewers** (Thomas); se possível restrinja a tags `v*`. Cadastre os secrets **do environment** (não do repositório): `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`.

Enquanto não houver conta/item, o job `webstore` fica bloqueado (impedimento externo) e a produção é só o zip `local` na GitHub Release.

## 3. Verificação manual do `activeTab` (G6)

Antes da primeira submissão (G6), **reconcilie** `docs/store-listing/permissions.md` e `docs/privacy-policy.md` com o `manifest.json` real do build `public` (`.output/chrome-mv3-public/manifest.json`): as permissões `activeTab`, `scripting`, `downloads` e `storage` chegam com a SPEC-0005. Cada permissão do manifest precisa ter justificativa e menção na política, e nenhuma justificativa pode citar permissão ausente do manifest. Até lá, os dois documentos são rascunho (cabeçalho "draft until reconciled").

Após instalar o zip (rc do staging ou `local`):

1. Abra uma página de demonstração com vídeo sem DRM e **não** clique no ícone: confirme que a extensão não lê a página (sem indicação de atividade).
2. Clique no ícone: a lista de mídias da aba deve aparecer e o download deve funcionar.
3. Abra outra aba e confirme que ela só é acessada depois de um novo clique.
4. Confirme que o bundle public não lista nenhum provider local (o `flavor-guard` já garante no CI).

## 4. Rollback

A loja não aceita versão menor, e o commit de uma tag antiga já é ancestral da `main`: um PR criado a partir da tag boa carregaria só o bump de versão, e taguear o commit antigo falha com `VERSION_MISMATCH`. O rollback é, portanto, um **novo commit na `main` que restaura a árvore boa**:

1. Parta da `main` atual: `git switch main && git pull && git switch -c fix/rollback-X.Y.(Z+1)`.
2. Restaure o código bom, por uma das formas (restaure **só os caminhos de código-fonte** — `src/`, `entrypoints/`, `public/` etc. —, nunca `.github/workflows` nem `scripts/release` de uma tag antiga, para não regredir o próprio pipeline):
   - `git revert <commits-ruins>` (um `revert` por commit; use `-m 1` para merge commits); ou
   - `git checkout <tag-boa> -- .` (restaura a árvore da versão boa; remova com `git rm` o que só existe na versão ruim).
3. Altere `version` em `package.json` para `X.Y.(Z+1)` (maior que a versão ruim já enviada) e commite.
4. Abra o PR para a `main` e faça o merge (merge commit).
5. Crie a tag `vX.Y.(Z+1)` **sobre o commit da `main` que contém o código restaurado** (seção 1) e acompanhe a pipeline e a aprovação no environment `webstore`.
6. Build `local`: reinstalar o zip da GitHub Release anterior.
7. Se a versão ruim ainda estiver em revisão/staging, cancele-a no Developer Dashboard.

## 4.1 Upload feito, publicação falhou

Se o `webstore` enviou o zip (upload) mas a etapa de publicação falhou, o Re-run do job falha já no upload, porque a loja recusa a versão como já enviada. Publique a versão enviada pelo Developer Dashboard, ou gere uma nova tag (versão maior) e rode a pipeline de novo.

## 5. Testes remotos (IT-02)

Precisam do GitHub real. Em um fork ou branch de teste com `gh` autenticado, empurre a tag `v0.0.0-rc.1` (com `package.json` na mesma versão nesse fork), espere o job `webstore` ficar aguardando aprovação e rode:

```sh
SDD_REMOTE_RELEASE_TAG=v0.0.0-rc.1 \
SDD_REMOTE_RELEASE_REPO=<dono>/<repo-do-fork> \
pnpm exec vitest run tests/release/release-remote.test.ts
```

Sem `SDD_REMOTE_RELEASE_TAG` os testes são pulados. Evidência: link da execução (`gh run view --web`). Não aprove o environment `webstore` no fork de teste (sem secrets o job falharia de qualquer forma).
