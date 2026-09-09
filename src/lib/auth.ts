import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

const COOKIE = 'storebuddy_session';

type Claims = { userId: string; tenantId?: string };

export function issueSession(res: Response, claims: Claims) {
  const token = jwt.sign(claims, env.JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return req.accepts('html') ? res.redirect('/login') : res.status(401).json({ error: 'Authentication required' });
    const claims = jwt.verify(token, env.JWT_SECRET) as Claims;
    if (!claims.tenantId) return req.accepts('html') ? res.redirect('/login') : res.status(403).json({ error: 'This account has no store access.' });
    const membership = await prisma.membership.findFirst({ where: { userId: claims.userId, tenantId: claims.tenantId } });
    if (!membership) return res.status(403).json({ error: 'Tenant access denied' });
    res.locals.auth = { userId: claims.userId, tenantId: claims.tenantId, role: membership.role };
    next();
  } catch {
    return req.accepts('html') ? res.redirect('/login') : res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Platform-admin routes are independent of tenant membership: the operator managing the whole
// business isn't necessarily a member of any single merchant's tenant.
export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return req.accepts('html') ? res.redirect('/admin/login') : res.status(401).json({ error: 'Authentication required' });
    const claims = jwt.verify(token, env.JWT_SECRET) as Claims;
    const user = await prisma.user.findUnique({ where: { id: claims.userId } });
    if (!user?.isPlatformAdmin) return req.accepts('html') ? res.redirect('/admin/login') : res.status(403).json({ error: 'Platform admin access required' });
    res.locals.admin = { userId: user.id, email: user.email };
    next();
  } catch {
    return req.accepts('html') ? res.redirect('/admin/login') : res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function tenantId(res: Response): string {
  return res.locals.auth.tenantId;
}

export function hashFingerprint(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
