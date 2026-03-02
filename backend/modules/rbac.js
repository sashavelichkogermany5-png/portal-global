const ROLE_RANK = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4
};

const normalizeRole = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['owner', 'admin', 'member', 'viewer'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'user') return 'member';
  if (normalized === 'superadmin') return 'owner';
  return 'member';
};

const hasRole = (role, required) => {
  const normalized = normalizeRole(role);
  const requiredRole = normalizeRole(required);
  return ROLE_RANK[normalized] >= ROLE_RANK[requiredRole];
};

const createRbacHelpers = ({ isSuperadmin, sendError }) => {
  const requireWorkspaceRole = (requiredRole) => (req, res, next) => {
    if (isSuperadmin(req.user)) return next();
    const role = normalizeRole(req.tenantRole || req.activeMembership?.role || 'member');
    if (!hasRole(role, requiredRole)) {
      return sendError(res, 403, 'Forbidden', 'Insufficient role');
    }
    return next();
  };

  const requireAnyRole = (roles = []) => (req, res, next) => {
    if (isSuperadmin(req.user)) return next();
    const role = normalizeRole(req.tenantRole || req.activeMembership?.role || 'member');
    const allowed = roles.map((item) => normalizeRole(item));
    if (!allowed.includes(role)) {
      return sendError(res, 403, 'Forbidden', 'Insufficient role');
    }
    return next();
  };

  return {
    normalizeRole,
    hasRole,
    requireWorkspaceRole,
    requireAnyRole
  };
};

module.exports = {
  ROLE_RANK,
  normalizeRole,
  hasRole,
  createRbacHelpers
};
