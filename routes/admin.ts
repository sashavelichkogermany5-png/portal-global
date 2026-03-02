import { Router } from 'express';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '../middleware/rbac';

const router = Router();
router.use(requireAdmin);

router.get('/users', async (req, res) => {
  const allUsers = await db.select().from(users);
  const safeUsers = allUsers.map(({ password, ...rest }) => rest);
  res.json(safeUsers);
});

router.patch('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { role, disabled } = req.body;

  const targetUser = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (targetUser.length === 0) return res.status(404).json({ error: 'User not found' });

  if (
    (role !== undefined && targetUser[0].role === 'ADMIN' && role !== 'ADMIN') ||
    (disabled !== undefined && disabled === true && targetUser[0].role === 'ADMIN')
  ) {
    const adminCount = await db.select({ count: users.id }).from(users).where(eq(users.role, 'ADMIN'));
    const c = Number((adminCount as any)[0]?.count ?? 0);
    if (c <= 1) return res.status(400).json({ error: 'Cannot remove the last admin' });
  }

  const updateData: any = {};
  if (role !== undefined) updateData.role = role;
  if (disabled !== undefined) updateData.disabled = disabled;

  await db.update(users).set(updateData).where(eq(users.id, id));
  res.json({ success: true });
});

export default router;
