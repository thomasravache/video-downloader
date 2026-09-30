import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'coverage/**', 'tools/**'] },
  ...tseslint.configs.strictTypeChecked,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Testes de tooling (SPEC-0002) são imutáveis no fluxo SDD: regras de tipo relaxadas aqui.
    files: ['tests/tooling/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    // ADR-0001: o core é puro. Globais de extensão não são imports, então o dependency-cruiser
    // não os vê; aqui os proibimos (testes e demais diretórios não são afetados).
    files: ['src/core/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'ADR-0001: o core não pode usar APIs de extensão (chrome).' },
        { name: 'browser', message: 'ADR-0001: o core não pode usar APIs de extensão (browser).' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'globalThis',
          property: 'chrome',
          message: 'ADR-0001: sem APIs de extensão no core.',
        },
        {
          object: 'globalThis',
          property: 'browser',
          message: 'ADR-0001: sem APIs de extensão no core.',
        },
        {
          object: 'window',
          property: 'chrome',
          message: 'ADR-0001: sem APIs de extensão no core.',
        },
        {
          object: 'window',
          property: 'browser',
          message: 'ADR-0001: sem APIs de extensão no core.',
        },
      ],
    },
  },
  {
    files: ['eslint.config.js', '.dependency-cruiser.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
