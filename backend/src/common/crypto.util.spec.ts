import { encryptToken, decryptToken, generateIdempotencyKey, verifyHmacSignature } from './crypto.util';

// Set test encryption key in env
process.env.HP_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex

describe('crypto.util', () => {
  describe('encryptToken / decryptToken', () => {
    it('encrypts and decrypts a HealthPay token round-trip', () => {
      const original = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token';
      const encrypted = encryptToken(original);
      expect(encrypted).not.toBe(original);
      expect(encrypted).toContain(':'); // iv:encrypted format
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(original);
    });

    it('each encryption produces a unique ciphertext (random IV)', () => {
      const token = 'same-token';
      const enc1 = encryptToken(token);
      const enc2 = encryptToken(token);
      expect(enc1).not.toBe(enc2);
    });

    it('correctly decrypts all token types', () => {
      const tokens = [
        'short',
        'a'.repeat(500),
        '{"type":"jwt","alg":"HS256"}',
        'token with spaces and special chars: #@!',
      ];
      tokens.forEach(t => {
        expect(decryptToken(encryptToken(t))).toBe(t);
      });
    });
  });

  describe('generateIdempotencyKey', () => {
    it('generates a 64-char hex SHA-256 hash', () => {
      const key = generateIdempotencyKey('deal-123', 'deduct', '2500');
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[a-f0-9]+$/);
    });

    it('produces deterministic output for same inputs', () => {
      const k1 = generateIdempotencyKey('deal-1', 'deduct', '500');
      const k2 = generateIdempotencyKey('deal-1', 'deduct', '500');
      expect(k1).toBe(k2);
    });

    it('produces different outputs for different inputs', () => {
      const k1 = generateIdempotencyKey('deal-1', 'deduct', '500');
      const k2 = generateIdempotencyKey('deal-1', 'payout', '500');
      expect(k1).not.toBe(k2);
    });
  });

  describe('verifyHmacSignature', () => {
    const secret  = 'test-webhook-secret';
    const payload = '{"event":"delivery","waybillId":"SETTE-001"}';

    it('verifies a correct HMAC signature', () => {
      const { createHmac } = require('crypto');
      const sig = createHmac('sha256', secret).update(payload).digest('hex');
      expect(verifyHmacSignature(payload, sig, secret)).toBe(true);
    });

    it('rejects an incorrect signature', () => {
      expect(verifyHmacSignature(payload, 'a'.repeat(64), secret)).toBe(false);
    });

    it('rejects a tampered payload', () => {
      const { createHmac } = require('crypto');
      const sig     = createHmac('sha256', secret).update(payload).digest('hex');
      const tampered = payload.replace('SETTE-001', 'SETTE-999');
      expect(verifyHmacSignature(tampered, sig, secret)).toBe(false);
    });
  });
});
