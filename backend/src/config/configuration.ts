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
    webhookSecret: process.env.SPRINT_WEBHOOK_SECRET,  // ME-03: added
  },
  sms: {
    gatewayUrl: process.env.SMS_GATEWAY_URL,
    apiKey:     process.env.SMS_GATEWAY_KEY,
    senderId:   process.env.SMS_SENDER_ID || 'SettePay',
  },
  app: {
    port:        Number(process.env.APP_PORT) || 3001,
    url:         process.env.APP_URL,
    frontendUrl: process.env.FRONTEND_URL || 'https://marketplace.sette.io',
  },
});
