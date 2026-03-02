import { Request, Response, NextFunction } from 'express';

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers['service-token'] === process.env.SERVICE_TOKEN) return next();

  // @ts-ignore
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  // @ts-ignore
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden: Admin required' });

  next();
};
