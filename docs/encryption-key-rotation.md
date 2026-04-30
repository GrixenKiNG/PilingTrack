# Encryption Key Rotation

How to rotate `ENCRYPTION_KEY` without losing access to data already
encrypted with the old key.

## Background

Sensitive fields (Telegram bot tokens, future API keys) are stored in the
DB as `enc:<base64>` ciphertext. AES-256-GCM, key from env.

If you ever change `ENCRYPTION_KEY` without a migration, every previously
encrypted value becomes unreadable. The versioned-key scheme below avoids
that.

## Ciphertext shapes

```
enc:<base64>           legacy, encrypted under ENCRYPTION_KEY
enc:v1:<base64>        encrypted under ENCRYPTION_KEY_V1
enc:v2:<base64>        encrypted under ENCRYPTION_KEY_V2
```

Decryption auto-detects the version from the prefix. Encryption writes the
**active** version (controlled by `ENCRYPTION_KEY_VERSION`, or — if unset —
the highest defined `ENCRYPTION_KEY_VN`, or `ENCRYPTION_KEY` as fallback).

## Procedure (no downtime)

### Phase 1 — preserve old key, introduce new key

In `.env` (and `.env.docker`, and prod secret store):

```bash
# Old key — keep it until ALL ciphertexts have been re-encrypted.
ENCRYPTION_KEY_V1=<old hex>      # was ENCRYPTION_KEY value

# New key — generate with: openssl rand -hex 32
ENCRYPTION_KEY_V2=<new hex>

# Active version for new writes.
ENCRYPTION_KEY_VERSION=v2
```

You can keep the original `ENCRYPTION_KEY=...` line for backward
compatibility, but the versioned vars take precedence.

Restart the app + workers. Behaviour:
- New writes are tagged `enc:v2:...`.
- Old `enc:...` and `enc:v1:...` rows still decrypt cleanly.

### Phase 2 — re-encrypt at rest (optional but recommended)

Run the rotation sweep so every row uses the active key:

```bash
npx tsx scripts/rotate-encryption-key.ts
```

This walks every encrypted column (currently: `TelegramConfig.botToken`)
and calls `reEncrypt()`. Idempotent — rows already at the active version
are skipped.

### Phase 3 — drop the old key

Once you have re-encrypted everything (verify by sampling: every row
should start with `enc:v2:`), remove the old keys from env:

```diff
- ENCRYPTION_KEY=<old>
- ENCRYPTION_KEY_V1=<old>
+ # only V2 remains
```

Restart. From now on, V1 is gone.

## Adding a new encrypted column

Three things:

1. Define the column in `prisma/schema.prisma` as `String` (not bytes).
2. On write: `await encrypt(plaintext)` → store the result.
3. On read: `if (isEncrypted(value)) return decrypt(value); else return value;`

The legacy fallback in step 3 lets you migrate existing plaintext data
incrementally — first deploy the read-side fallback, then start writing
encrypted values.

## Tests

`src/core/security/__tests__/encryption.test.ts` pins the contract:
legacy + versioned round-trips, rotation behaviour, missing-key error,
re-encrypt upgrade path, tamper detection.
