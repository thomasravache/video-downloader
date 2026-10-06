/**
 * TypeScript ambient declarations for virtual AES-128 modules.
 * VD_AES128_LOCAL_ONLY
 */
declare module 'virtual:aes128-policy' {
  export const keyPolicy: import('../core/ports').KeyPolicyPort | undefined;
}

declare module 'virtual:aes128-decrypt' {
  export class KeyFetchError extends Error {
    readonly code: 'KEY_FAILED';
  }
  export class DecryptError extends Error {
    readonly code: 'DECRYPT_FAILED';
  }
  export const aes128Handler:
    | {
        readonly KeyFetchError: typeof KeyFetchError;
        readonly DecryptError: typeof DecryptError;
        loadKey(bytes: Uint8Array): Promise<CryptoKey>;
        decryptSegment(
          key: CryptoKey,
          iv: Uint8Array,
          bytes: Uint8Array,
          type?: 'ts' | 'fmp4',
        ): Promise<Uint8Array>;
        deriveIv(mediaSequence: number, segmentIndex: number): Uint8Array;
      }
    | undefined;
}
