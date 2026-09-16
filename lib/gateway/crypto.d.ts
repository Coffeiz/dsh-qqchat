/** QQ bind_task returns base64(iv[12] + ciphertext + gcmTag[16]). */
export declare function decryptQQSecret(encryptedBase64: string, keyBase64: string): string;
