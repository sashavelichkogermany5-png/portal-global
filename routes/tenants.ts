import { Router } from 'express';
import { db } from '../db';
import { tenants, memberships, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

router.get('/', async (req, res) => {
  // @ts-ignore
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  // @ts-ignore
  if (req.user.isSuperadmin) {
    const all = await db.select().from(tenants);
    return res.json(all);
  }

  // @ts-ignore
  const userTenants = await db.select({
    id: tenants.id,
    name: tenants.name,
    slug: tenants.slug,
    role: memberships.role,
  })
    .from(tenants)
    .innerJoin(memberships, eq(tenants.id, memberships.tenantId))
    // @ts-ignore
    .where(eq(memberships.userId, req.user.id));

  res.json(userTenants);
});

router.post('/', async (req, res) => {
  // @ts-ignore
  if (!req.user?.isSuperadmin) return res.status(403).json({ error: 'Only superadmin can create tenants' });

  const { name, slug } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'Name and slug required' });

  try {
    const [newTenant] = await db.insert(tenants).values({ name, slug }).returning();

    await db.insert(memberships).values({
      // @ts-ignore
      userId: req.user.id,
      tenantId: newTenant.id,
      role: 'owner',
    });

    res.status(201).json(newTenant);
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    throw err;
  }
});

router.get('/:id/members', async (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
  // @ts-ignore
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  // @ts-ignore
  if (!req.user.isSuperadmin) {
    const membership = await db.select()
      .from(memberships)
      .where(and(
        // @ts-ignore
        eq(memberships.userId, req.user.id),
        eq(memberships.tenantId, tenantId)
      ))
      .limit(1);

    if (membership.length === 0 || !['owner', 'admin'].includes((membership as any)[0].role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  const members = await db.select({
    userId: memberships.userId,
    email: users.email,
    role: memberships.role,
    joinedAt: memberships.joinedAt,
  })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.tenantId, tenantId));

  res.json(members);
});

router.post('/:id/members', async (req, res) => {
  const tenantId = parseInt(req.params.id, 10);
  // @ts-ignore
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, role } = req.body as { userId: number; role: 'owner'|'admin'|'member' };
  if (!userId || !role) return res.status(400).json({ error: 'userId and role required' });

  // @ts-ignore
  if (!req.user.isSuperadmin) {
    const m = await db.select().from(memberships).where(and(
      // @ts-ignore
      eq(memberships.userId, req.user.id),
      eq(memberships.tenantId, tenantId)
    )).limit(1);

    if (m.length === 0 || !['owner','admin'].includes((m as any)[0].role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  await db.insert(memberships).values({ userId, tenantId, role });
  res.status(201).json({ success: true });
});

export default router;
