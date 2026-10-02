# Finalidade única e justificativa das permissões

> **Draft until reconciled:** rascunho até ser conferido contra o `manifest.json` real (permissões `activeTab`, `scripting`, `downloads`, `storage` chegam com a SPEC-0005); ver `docs/runbook.md`, seção 3, antes da primeira submissão.

Campos do painel do desenvolvedor (Privacy practices). Redigidos em inglês porque a revisão da loja é feita nesse idioma; tradução resumida ao final.

## Single purpose

Detect DRM-free video and audio files on the page the user is viewing and let the user download them to their computer.

## Permission justifications

- **activeTab** — Grants temporary access to the current tab only after the user clicks the extension icon, so the extension can read the URLs of the media files of that page. No broad host permissions are requested and nothing runs on pages the user did not invoke it on.
- **scripting** — Used to inject, in the active tab and only after the user invokes the extension, the small script that collects the media URLs the page loads. It is combined with `activeTab`; no remote code is loaded.
- **downloads** — Used to save the file the user picked to their computer through the browser's download manager, straight from the original site.
- **storage** — Used to keep the user's own extension preferences (for example language and interface options) in `chrome.storage`. No personal or browsing data is stored.

## Data usage disclosures

- Does not collect or transmit personal data, browsing history, or user activity; URLs are held in memory per tab and discarded.
- Does not sell data or use it for purposes unrelated to the single purpose.
- Privacy policy: `docs/privacy-policy.md` (public URL to be filled in the panel).
- Remote code: none.

## Resumo em português

- `activeTab`: acesso temporário à aba só depois do clique no ícone, sem permissões de host amplas.
- `scripting`: injeta na aba ativa, após o clique, o script que coleta as URLs de mídia da página.
- `downloads`: salva no computador o arquivo escolhido, direto do site de origem.
- `storage`: guarda preferências da própria extensão; nenhum dado pessoal.
