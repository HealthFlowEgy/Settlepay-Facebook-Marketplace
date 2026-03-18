export default () => ({
  database: { url: process.env.DATABASE_URL },
  redis:    { url: process.env.REDIS_URL || 'redis://localhost:6379' },
  jwt: {
    secret:    process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  healthpay: {
    apiHeader:      process.env.HP_API_HEADER,
    apiKey:         process.env.HP_API_KEY,
    baseUrl:        process.env.HP_BASE_URL || 'https://sword.beta.healthpay.tech/graphql',
    webhookSecret:  process.env.HP_WEBHOOK_SECRET,
    tokenRefreshInterval: Number(process.env.HP_TOKEN_REFRESH_INTERVAL_SECONDS) || 82800,
    encryptionKey:  process.env.HP_TOKEN_ENCRYPTION_KEY,
  },
  commission: {
    rate:   Number(process.env.COMMISSION_RATE)    || 0.018,
    minEgp: Number(process.env.COMMISSION_MIN_EGP) || 0.75,
  },
  escrow: {
    buyerConfirmTimeoutHours: Number(process.env.ESCROW_BUYER_CONFIRM_TIMEOUT_HOURS) || 24,
    deliveryExpiryDays:       Number(process.env.ESCROW_DELIVERY_EXPIRY_DAYS)        || 14,
    disputeWindowHours:       Number(process.env.DISPUTE_WINDOW_HOURS)               || 48,
    disputeResolutionHours:   Number(process.env.DISPUTE_RESOLUTION_HOURS)           || 72,
    // Maximum automatic retry attempts before escalating to ops for manual resolution
    maxRetryAttempts:         Number(process.env.ESCROW_MAX_RETRY_ATTEMPTS)          || 3,
  },
  meta: {
    pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN,
    verifyToken:     process.env.META_VERIFY_TOKEN,
    appSecret:       process.env.META_APP_SECRET,
  },
  bosta: {
    apiKey:        process.env.BOSTA_API_KEY,
    webhookSecret: process.env.BOSTA_WEBHOOK_SECRET,
  },
  sprint: {
    apiKey:        process.env.SPRINT_API_KEY,
    webhookSecret: process.env.SPRINT_WEBHOOK_SECRET,
  },
  sms: {
    gatewayUrl: process.env.SMS_GATEWAY_URL,
    apiKey:     process.env.SMS_GATEWAY_KEY,
    senderId:   process.env.SMS_SENDER_ID || 'SettePay',
  },
  // Valify KYC — GAP-4 fix: was missing from configuration
  valify: {
    apiKey:  process.env.VALIFY_API_KEY,
    baseUrl: process.env.VALIFY_BASE_URL || 'https://api.valify.eg',
  },
  aws: {
    region:          process.env.AWS_REGION          || 'eu-west-1',
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket:        process.env.S3_BUCKET           || 'settepay-marketplace-evidence',
  },
  slack: {
    opsWebhook: process.env.SLACK_OPS_WEBHOOK,
  },
  app: {
    port:        Number(process.env.APP_PORT) || 3001,
    url:         process.env.APP_URL,
    frontendUrl: process.env.FRONTEND_URL || 'https://marketplace.sette.io',
  },
});
