import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { clearSession, issueSession } from '../lib/auth.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await prisma.user.findUnique({ where: { email: String(email || '').toLowerCase() } });
  if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
  const membership = await prisma.membership.findFirst({ where: { userId: user.id }, include: { tenant: true } });
  if (!membership) return res.status(403).json({ error: 'No store access is assigned to this account' });
  issueSession(res, { userId: user.id, tenantId: membership.tenantId });
  res.json({ user: { id: user.id, email: user.email, name: user.name }, tenant: membership.tenant });
});

authRouter.post('/logout', (_req, res) => { clearSession(res); res.status(204).end(); });
