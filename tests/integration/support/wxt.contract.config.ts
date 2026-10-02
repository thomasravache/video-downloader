/**
 * Config do WXT usada só por CT-01: a mesma de wxt.config.ts, mas com a saída em CT_OUT_DIR,
 * para que o build com providers extras (PROVIDERS_EXTRA_DIR) nunca sobrescreva `.output/`.
 */
import { defineConfig } from 'wxt';
import base from '../../../wxt.config';

const outDir = process.env['CT_OUT_DIR'];
if (!outDir) {
  throw new Error('CT_OUT_DIR não definido');
}

export default defineConfig({ ...base, outDir });
