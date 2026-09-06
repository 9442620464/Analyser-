import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';

const passwordHash = await bcrypt.hash(env.BOOTSTRAP_PASSWORD, 12);
const user = await prisma.user.upsert({ where: { email: env.BOOTSTRAP_EMAIL }, update: { passwordHash }, create: { email: env.BOOTSTRAP_EMAIL, passwordHash, name: 'Store Owner' } });
const slug = env.BOOTSTRAP_STORE_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'store';
const tenant = await prisma.tenant.upsert({ where: { slug }, update: { name: env.BOOTSTRAP_STORE_NAME }, create: { slug, name: env.BOOTSTRAP_STORE_NAME } });
await prisma.membership.upsert({ where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } }, update: { role: 'OWNER' }, create: { userId: user.id, tenantId: tenant.id, role: 'OWNER' } });
await prisma.alertSetting.upsert({ where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id } });
console.log(`Seeded ${user.email} for ${tenant.name}`);
await prisma.$disconnect();
