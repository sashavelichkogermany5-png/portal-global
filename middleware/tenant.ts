import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { memberships } from '../db/schema';
import { and, eq } from 'drizzle-orm';

declare global {
  namespace Express {
    interface Request {
      tenant?: { id: number };
    }
  }
}

export const tenantMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const tenantIdHeader = req.headers['x-tenant-id'];
  if (!tenantIdHeader) return next();

  const tenantId = parseInt(tenantIdHeader as string, 10);
  if (isNaN(tenantId)) return res.status(400).json({ error: 'Invalid X-Tenant-Id' });

  req.tenant = { id: tenantId };

  // @ts-ignore
  if (req.user) {
    const membership = await db.select()
      .from(memberships)
      .where(and(
        // @ts-ignore
        eq(memberships.userId, req.user.id),
        eq(memberships.tenantId, tenantId),
      ))
      .limit(1);

    // @ts-ignore
    if (membership.length === 0 && !req.user.isSuperadmin) {
      return res.status(403).json({ error: 'Access to this tenant denied' });
    }
  }

  next();
};
