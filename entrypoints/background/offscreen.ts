import type { OffscreenPort } from '../../src/core/ports';

const OFFSCREEN_PATH = 'offscreen.html';

/** Porta do documento offscreen (SPEC-0012): um por perfil, criado sob demanda (razão BLOBS). */
export function createOffscreenPort(): OffscreenPort {
  /** Criações simultâneas compartilham a mesma chamada (o Chrome rejeita o segundo documento). */
  let creating: Promise<void> | undefined;

  async function isOpen(): Promise<boolean> {
    const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return contexts.length > 0;
  }

  return {
    async ensure() {
      creating ??= (async () => {
        if (!(await isOpen())) {
          await browser.offscreen.createDocument({
            url: OFFSCREEN_PATH,
            reasons: ['BLOBS'],
            justification: 'Juntar os segmentos HLS em um MP4 e entregar o arquivo como blob URL.',
          });
        }
      })().finally(() => {
        creating = undefined;
      });
      await creating;
    },
    isOpen,
    async send(command) {
      await browser.runtime.sendMessage(command);
    },
    async close() {
      if (await isOpen()) {
        await browser.offscreen.closeDocument();
      }
    },
  };
}
