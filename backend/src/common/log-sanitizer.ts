/**
 * Log Sanitizer — Complete Redaction List (C.4 / SRS §7.1)
 *
 * Ensures that sensitive fields are NEVER written to application logs.
 * Covers: HealthPay credentials, auth tokens, KYC data, payment card data,
 * and encryption keys.
 */

const SENSITIVE_FIELDS = [
  // HealthPay credentials
  'userToken',
  'merchantToken',
  'apiKey',
  'hp_user_token',
  'hpUserToken',

  // Auth
  'otp',
  'password',
  'pin',
  'jwt',
  'token',
  'authorization',

  // KYC
  'nationalId',
  'national_id',
  'selfieBase64',
  'idImageBase64',

  // Payment card data (HealthPay iframe handles, but belt-and-suspenders)
  'cardNumber',
  'cvv',
  'pan',
  'track1',
  'track2',

  // Encryption keys (should never reach logs but guard anyway)
  'HP_TOKEN_ENCRYPTION_KEY',
  'JWT_SECRET',
  'HP_API_KEY',
];

/**
 * Recursively sanitize an object by redacting any field whose key
 * matches (case-insensitive) any entry in SENSITIVE_FIELDS.
 */
export function sanitizeLog(
  obj: Record<string, any>,
): Record<string, any> {
  if (!obj || typeof obj !== 'object') return obj;

  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_FIELDS.some((f) =>
        k.toLowerCase().includes(f.toLowerCase()),
      )
        ? '[REDACTED]'
        : typeof v === 'object' && v !== null
          ? Array.isArray(v)
            ? v.map((item) =>
                typeof item === 'object' && item !== null
                  ? sanitizeLog(item)
                  : item,
              )
            : sanitizeLog(v)
          : v,
    ]),
  );
}

export { SENSITIVE_FIELDS };
