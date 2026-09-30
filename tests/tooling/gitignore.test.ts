import { describe, expect, it } from 'vitest';
import { run } from './helpers';

describe('.gitignore', () => {
  it.each(['.env', '.env.local', '.output/x', 'key.pem', 'a.crx'])(
    'SPEC-0002:IT-02 %s é ignorado pelo git',
    (path) => {
      const r = run('git', ['check-ignore', '-q', path]);
      expect(r.code, `${path} deveria estar ignorado`).toBe(0);
    },
  );
});
