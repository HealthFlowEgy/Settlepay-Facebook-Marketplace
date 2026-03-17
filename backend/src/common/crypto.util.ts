import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

export function encryptToken(plaintext: string): string {
  const key = Buffer.from(process.env.HP_TOKEN_ENCRYPTION_KEY!, 'hex');
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // Store iv:encrypted as base64
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, encHex] = ciphertext.split(':');
  const key  = Buffer.from(process.env.HP_TOKEN_ENCRYPTION_KEY!, 'hex');
  const iv   = Buffer.from(ivHex, 'hex');
  const enc  = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]);
  return decrypted.toString('utf8');
}

export function generateIdempotencyKey(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}
