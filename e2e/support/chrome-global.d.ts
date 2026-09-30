/** `chrome` como visto dentro de serviceWorker.evaluate(): só o mínimo usado pelos testes E2E. */
declare const chrome: {
  runtime: {
    sendMessage(message: unknown, callback: (response: unknown) => void): void;
  };
};
