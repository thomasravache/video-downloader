import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { defineConfig } from 'vitest/config';

// O WXT resolve o manifesto ao iniciar o plugin; sob o vitest o modo é "test", então fixamos o flavor.
process.env['FLAVOR'] ??= 'public';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'entrypoints/**/*.ts'],
    },
    projects: [
      {
        extends: false,
        test: {
          name: 'unit',
          include: [
            'src/**/*.test.ts',
            'tests/unit/**/*.test.ts',
            'tests/harness/**/*.test.ts',
            'tests/tooling/**/*.test.ts',
            'tests/ci/**/*.test.ts',
          ],
          exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
          // Testes de arquitetura/tooling mutam a árvore e rodam lint/typecheck: nunca em paralelo.
          fileParallelism: false,
        },
      },
      {
        extends: false,
        plugins: [WxtVitest()],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts', 'tests/harness/**/*.integration.test.ts'],
        },
      },
    ],
  },
});
