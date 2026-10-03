/**
 * Regras de fronteira do ADR-0001 / ADR-0011. `pnpm arch` = depcruise src entrypoints.
 * Limitação conhecida: globais (`chrome.*`, `browser.*` injetado pelo WXT) não são imports e,
 * portanto, não são detectáveis aqui — cobertos por lint/revisão.
 */

/** Módulos que dão acesso a APIs de extensão/navegador (proibidos no core). */
const BROWSER_API_MODULES =
  '(^|/)node_modules/(wxt/(dist/)?(browser|testing|utils/(storage|content-script|inject-script))|@wxt-dev/browser|webextension-polyfill|@webext-core|@types/chrome|@types/webextension-polyfill)(/|\\.|$)';

/** Especificadores de módulo (não resolvidos pelo cruiser) que dão acesso a APIs de extensão. */
const BROWSER_API_SPECIFIERS =
  '^(#[a-z-]+|wxt/(browser|testing)|@wxt-dev/browser|webextension-polyfill|@webext-core/|@types/(chrome|webextension-polyfill))(/|$)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-core-to-providers',
      comment: 'ADR-0001: o core não conhece providers (inversão de dependência).',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/providers/' },
    },
    {
      name: 'no-core-to-entrypoints',
      comment: 'ADR-0001: o core não depende de entrypoints/UI.',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^entrypoints/' },
    },
    {
      name: 'no-provider-to-provider',
      comment: 'ADR-0011: cada provider é isolado; nenhum importa outro provider.',
      severity: 'error',
      from: { path: '^src/providers/([^/]+)/' },
      to: { path: '^src/providers/[^/]+/', pathNot: '^src/providers/$1/' },
    },
    {
      name: 'no-provider-to-ui',
      comment: 'ADR-0001: providers não dependem de entrypoints/UI.',
      severity: 'error',
      from: { path: '^src/providers/' },
      to: { path: '^entrypoints/' },
    },
    {
      name: 'no-popup-to-providers',
      comment: 'ADR-0001: o popup fala com o core/background, nunca direto com providers.',
      severity: 'error',
      from: { path: '^entrypoints/popup/' },
      to: { path: '^src/providers/' },
    },
    {
      name: 'no-core-browser-api',
      comment: 'ADR-0001: o core é puro; APIs de navegador ficam em adaptadores.',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: `${BROWSER_API_MODULES}|${BROWSER_API_SPECIFIERS}` },
    },
    {
      name: 'not-to-unresolvable',
      comment:
        'Imports não resolvidos não podem escapar das regras de fronteira. Exceção documentada: ' +
        'aliases virtuais do WXT (#imports, #build, ...), que resolvem para .wxt (excluído) — no ' +
        'core eles são proibidos por no-core-browser-api — e o módulo virtual `virtual:providers` ' +
        '(ADR-0011), que só o background pode importar (no-virtual-providers-outside-background).',
      severity: 'error',
      from: { path: '^(src|entrypoints)/' },
      to: { couldNotResolve: true, pathNot: '^(#[a-z]|virtual:providers$)' },
    },
    {
      name: 'no-virtual-providers-outside-background',
      comment:
        'ADR-0001/ADR-0011: o registro de providers (`virtual:providers`) é consumido só pelo ' +
        'background; core, providers e popup nunca o importam.',
      severity: 'error',
      from: { pathNot: '^entrypoints/background(\\.ts$|/)' },
      to: { path: '^virtual:providers$' },
    },
    {
      name: 'm3u8-parser-only-in-core',
      comment: 'ADR-0013: m3u8-parser (parse puro de HLS) só pode ser importado por src/core.',
      severity: 'error',
      from: { pathNot: '^src/core/' },
      to: { path: '(^|/)node_modules/m3u8-parser(/|$)' },
    },
    {
      name: 'mux-js-only-in-offscreen',
      comment:
        'ADR-0013: mux.js (transmux TS->MP4) só pode ser importado por entrypoints/offscreen.',
      severity: 'error',
      from: { pathNot: '^entrypoints/offscreen/' },
      to: { path: '(^|/)node_modules/mux\\.js(/|$)' },
    },
    {
      name: 'mediabunny-only-in-offscreen',
      comment:
        'ADR-0014: mediabunny (junção de trilhas MP4) só pode ser importado por entrypoints/offscreen.',
      severity: 'error',
      from: { pathNot: '^entrypoints/offscreen/' },
      to: { path: '(^|/)node_modules/mediabunny(/|$)' },
    },
    {
      name: 'no-circular',
      comment: 'Ciclos de importação são proibidos.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)\\.wxt/' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
