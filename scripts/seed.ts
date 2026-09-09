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

if (env.BOOTSTRAP_ADMIN_EMAIL && env.BOOTSTRAP_ADMIN_PASSWORD) {
  const adminPasswordHash = await bcrypt.hash(env.BOOTSTRAP_ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: env.BOOTSTRAP_ADMIN_EMAIL },
    update: { passwordHash: adminPasswordHash, isPlatformAdmin: true },
    create: { email: env.BOOTSTRAP_ADMIN_EMAIL, passwordHash: adminPasswordHash, name: 'Platform Admin', isPlatformAdmin: true }
  });
  console.log(`Seeded platform admin ${admin.email} — sign in at /admin/login`);
} else {
  console.log('No BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD set — skipping platform admin seed. Set both in .env to create one.');
}

await prisma.$disconnect();
