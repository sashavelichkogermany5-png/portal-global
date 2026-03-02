const ROLE_RANK = {
    viewer: 1,
    member: 2,
    admin: 3,
    owner: 4,
    superadmin: 5
};

const normalizeTenantRole = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'member';
    if (normalized === 'user') return 'member';
    if (normalized === 'viewer') return 'viewer';
    if (normalized === 'member') return 'member';
    if (normalized === 'admin') return 'admin';
    if (normalized === 'owner') return 'owner';
    if (normalized === 'superadmin') return 'superadmin';
    return 'member';
};

const hasMinimumRole = (role, required) => {
    const currentRank = ROLE_RANK[normalizeTenantRole(role)] || 0;
    const requiredRank = ROLE_RANK[normalizeTenantRole(required)] || 0;
    return currentRank >= requiredRank;
};

const isOwnerRole = (role) => {
    const normalized = normalizeTenantRole(role);
    return normalized === 'owner' || normalized === 'superadmin';
};

const isAdminRole = (role) => {
    const normalized = normalizeTenantRole(role);
    return normalized === 'admin' || normalized === 'owner' || normalized === 'superadmin';
};

const isMemberRole = (role) => {
    const normalized = normalizeTenantRole(role);
    return normalized === 'member' || normalized === 'admin' || normalized === 'owner' || normalized === 'superadmin';
};

const isViewerRole = (role) => normalizeTenantRole(role) === 'viewer';

module.exports = {
    ROLE_RANK,
    normalizeTenantRole,
    hasMinimumRole,
    isOwnerRole,
    isAdminRole,
    isMemberRole,
    isViewerRole
};
