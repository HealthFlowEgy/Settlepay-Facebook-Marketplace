/**
 * SettePay Marketplace — Database Seed
 * Creates development test data
 * Run: npx ts-node prisma/seed.ts
 */

import { PrismaClient, UserKycTier, UserKycStatus, DealStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding SettePay Marketplace database...\n');

  // ── Test Users ──────────────────────────────────────────────────────────────
  const seller = await prisma.user.upsert({
    where:  { mobile: '+201000000001' },
    update: {},
    create: {
      mobile:     '+201000000001',
      firstName:  'Ahmed',
      lastName:   'Mohamed',
      email:      'ahmed.seller@settepay.test',
      isProvider: true,
      kycTier:    UserKycTier.TIER_1,
      kycStatus:  UserKycStatus.APPROVED,
      hpUid:      'hp-seller-test-001',
      // hpUserToken: would be set after actual HealthPay auth
    },
  });
  console.log('✅ Created seller:', seller.id, '—', seller.firstName, seller.lastName);

  const buyer = await prisma.user.upsert({
    where:  { mobile: '+201000000002' },
    update: {},
    create: {
      mobile:     '+201000000002',
      firstName:  'Sara',
      lastName:   'Ahmed',
      email:      'sara.buyer@settepay.test',
      isProvider: false,
      kycTier:    UserKycTier.TIER_1,
      kycStatus:  UserKycStatus.APPROVED,
      hpUid:      'hp-buyer-test-002',
    },
  });
  console.log('✅ Created buyer:', buyer.id, '—', buyer.firstName, buyer.lastName);

  // ── Sample Deals ────────────────────────────────────────────────────────────
  const dealData = [
    { amount: 2500, itemDescription: 'iPhone 14 Pro 256GB Space Black',       status: DealStatus.ESCROW_ACTIVE   },
    { amount: 750,  itemDescription: 'Samsung Galaxy Buds Pro — White',       status: DealStatus.SHIPPED         },
    { amount: 1200, itemDescription: 'Sony WH-1000XM5 Headphones',            status: DealStatus.DELIVERY_CONFIRMED },
    { amount: 8500, itemDescription: 'MacBook Air M2 — 8GB 256GB Silver',    status: DealStatus.SETTLED         },
    { amount: 450,  itemDescription: 'PS5 DualSense Controller — Midnight',   status: DealStatus.DISPUTED        },
    { amount: 3200, itemDescription: 'iPad Pro 11" WiFi 128GB Space Grey',   status: DealStatus.PENDING         },
  ];

  for (const data of dealData) {
    const deal = await prisma.deal.create({
      data: {
        sellerId:        seller.id,
        buyerId:         buyer.id,
        amount:          data.amount,
        itemDescription: data.itemDescription,
        status:          data.status,
        escrowActivatedAt: ['ESCROW_ACTIVE','SHIPPED','DELIVERY_CONFIRMED','SETTLED','DISPUTED'].includes(data.status)
          ? new Date() : undefined,
        shippedAt: ['SHIPPED','DELIVERY_CONFIRMED','SETTLED'].includes(data.status)
          ? new Date() : undefined,
        deliveredAt: ['DELIVERY_CONFIRMED','SETTLED'].includes(data.status)
          ? new Date() : undefined,
        settledAt: data.status === DealStatus.SETTLED ? new Date() : undefined,
        commission: data.status === DealStatus.SETTLED ? Math.max(data.amount * 0.018, 0.75) : undefined,
        netPayout: data.status === DealStatus.SETTLED ? data.amount - Math.max(data.amount * 0.018, 0.75) : undefined,
        disputeWindowEnd: data.status === DealStatus.DELIVERY_CONFIRMED
          ? new Date(Date.now() + 48 * 3_600_000) : undefined,
      },
    });
    console.log(`✅ Created deal [${data.status}]: ${data.itemDescription} — EGP ${data.amount}`);

    // Commission record for settled deals
    if (data.status === DealStatus.SETTLED) {
      const commission = Math.max(data.amount * 0.018, 0.75);
      await prisma.commissionRecord.create({
        data: {
          dealId:           deal.id,
          grossAmount:      data.amount,
          commissionRate:   0.018,
          commissionAmount: commission,
          netPayout:        data.amount - commission,
        },
      });
    }

    // Dispute for disputed deals
    if (data.status === DealStatus.DISPUTED) {
      await prisma.dispute.create({
        data: {
          dealId:             deal.id,
          raisedById:         buyer.id,
          status:             'EVIDENCE_COLLECTION',
          evidenceDeadline:   new Date(Date.now() + 24 * 3_600_000),
          resolutionDeadline: new Date(Date.now() + 72 * 3_600_000),
        },
      });
      console.log(`   ↳ Created dispute for deal`);
    }
  }

  // ── Merchant Token placeholder ──────────────────────────────────────────────
  await prisma.merchantToken.upsert({
    where:  { id: 'singleton' },
    update: {},
    create: {
      id:        'singleton',
      token:     'SEED_TOKEN_REPLACE_WITH_REAL_HEALTHPAY_TOKEN',
      expiresAt: new Date(Date.now() + 23 * 3_600_000),
    },
  });
  console.log('✅ Created placeholder merchant token');

  console.log('\n🎉 Seed complete!');
  console.log('\n📊 Summary:');
  console.log('   Sellers:  1');
  console.log('   Buyers:   1');
  console.log(`   Deals:    ${dealData.length}`);
  console.log('\n🔑 Test credentials:');
  console.log('   Seller mobile: +201000000001');
  console.log('   Buyer mobile:  +201000000002');
  console.log('   OTP (beta):    Use HealthPay test OTP');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
