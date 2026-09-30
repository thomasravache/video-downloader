---
id: ADR-0011
title: Providers por site e builds public/local
status: accepted
origin: decision
date: 2026-09-30
pillars: [arquitetura]
decision_makers: [Thomas]
consulted: []
informed: []
supersedes:
superseded_by:
enforced_by: "dependency-cruiser (fronteiras) + teste sobre dist/public que falha se contiver provider local (SPEC-0006:IT-01)"
---

# ADR-0011 — Providers por site e builds public/local

## Contexto e Problema
A extensão deve detectar vídeos em sites muito diferentes (páginas genéricas, plataformas de curso, YouTube) e ser publicada na Chrome Web Store, cuja política proíbe download do YouTube e "contornar paywalls ou restrições de login". O usuário quer publicar o que a loja permitir e rodar localmente o restante. Como isolar o código específico de cada site e garantir que o build da loja nunca contenha o que ela proíbe?

## Direcionadores da Decisão
- Build `public` precisa ser aprovado na revisão da Web Store.
- Adicionar um site novo não pode exigir mudança no núcleo.
- A exclusão de código proibido tem que ser verificável por teste, não por disciplina.
- Nenhum build contorna DRM ou criptografia de stream.

## Opções Consideradas
- **A. Providers como módulos com manifesto (`flavors: [public, local]`) e registro gerado em tempo de build** — o bundle `public` só importa providers com `public`.
- **B. Um build único com feature flag em runtime** desligando providers proibidos.
- **C. Dois repositórios/forks** (loja e local).

## Resultado da Decisão
**Opção escolhida:** "A", porque o código excluído não existe no bundle `public` (revisores da loja inspecionam o código — flag em runtime, opção B, ainda seria rejeitada), e evita a divergência de manter forks (C).

**Contrato do provider (resumo; detalhado em SPEC-0005):**
```ts
interface Provider {
  id: string;                       // 'generic', 'hotmart', 'youtube'
  flavors: ReadonlyArray<'public' | 'local'>;
  matches(url: URL): boolean;       // generic: sempre true, prioridade mais baixa
  detect(ctx: DetectionContext): Promise<VideoCandidate[]>;
}
interface VideoCandidate {
  id: string; tabId: number; pageUrl: string;
  mediaUrl: string; kind: 'file';   // 'hls' | 'dash' no roadmap
  mimeType?: string; title?: string; sizeBytes?: number;
  protection: 'none' | 'drm';       // 'drm' → nunca oferece download
}
```

**Regras:**
- Todo provider declara `flavors`; o gerador de registro lê `import.meta.env.FLAVOR` e só inclui os compatíveis.
- Provider nunca implementa decriptação, extração de chave, ou interceptação de EME/CDM; candidato com `protection: 'drm'` não tem ação de download.
- Providers dependem só de `core/`; nunca uns dos outros.

### Consequências
- **Boa**, porque YouTube e providers de login podem evoluir no build `local` sem ameaçar a listagem na loja.
- **Boa**, porque cada site novo é um diretório novo com seus próprios testes.
- **Ruim**, porque há duas variantes para testar no CI (build e E2E rodam para `public` e `local`).

### Confirmação (G3)
dependency-cruiser em `.dependency-cruiser.cjs` (ADR-0001) e teste de integração que inspeciona `dist/public` e falha se encontrar identificador de provider `local-only` (SPEC-0006:IT-01).

## Prós e Contras das Opções
| Critério (peso) | A. Registro por build | B. Flag runtime | C. Forks |
|---|---|---|---|
| Aprovação na loja (5) | 5 | 2 | 5 |
| Custo de manutenção (4) | 4 | 5 | 1 |
| Verificável por teste (4) | 5 | 3 | 2 |
| Simplicidade (2) | 4 | 5 | 3 |
| **Total ponderado** | **69** | **56** | **43** |

## Mais Informações
- Chrome Web Store Program Policies (consultado 2026-09-30): "Do not encourage, facilitate, or enable the unauthorized access, download, or streaming of copyrighted content or media" e proibição de contornar paywalls/login — https://developer.chrome.com/docs/webstore/program-policies/policies
- Troubleshooting violations — download de YouTube como motivo comum de remoção — https://developer.chrome.com/docs/webstore/troubleshooting
- WXT modes/env (`--mode`, `import.meta.env`) — confirmar sintaxe na versão 0.21.x em SPEC-0002.
