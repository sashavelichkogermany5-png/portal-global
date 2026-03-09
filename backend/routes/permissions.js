import { Router } from 'express';
import { User, Permission } from '../models';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Get user permissions
router.get('/permissions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.user;
    
    const permissions = await Permission.findAll({
      where: { user_id: id },
      attributes: ['id', 'permission', 'resource', 'created_at']
    });

    res.json({
      userId: id,
      permissions: permissions.map(p => ({
        id: p.id,
        permission: p.permission,
        resource: p.resource,
        createdAt: p.createdAt
      }))
    });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ error: 'Failed to get permissions' });
  }
});

// Add permission
router.post('/permissions', authenticateToken, async (req, res) => {
  try {
    const { userId, permission, resource } = req.body;
    
    // Only owners can add permissions to other users
    if (req.user.role !== 'owner' && req.user.id !== userId) {
      return res.status(403).json({ error: 'Only owners can add permissions to other users' });
    }

    const existingPermission = await Permission.findOne({
      where: { user_id: userId, permission, resource }
    });

    if (existingPermission) {
      return res.status(409).json({ error: 'Permission already exists' });
    }

    const newPermission = await Permission.create({
      user_id: userId,
      permission,
      resource
    });

    res.status(201).json({
      success: true,
      permission: {
        id: newPermission.id,
        userId,
        permission,
        resource,
        createdAt: newPermission.createdAt
      }
    });
  } catch (error) {
    console.error('Add permission error:', error);
    res.status(500).json({ error: 'Failed to add permission' });
  }
});

// Remove permission
router.delete('/permissions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Only owners can remove permissions
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can remove permissions' });
    }

    const permission = await Permission.findByPk(id);
    if (!permission) {
      return res.status(404).json({ error: 'Permission not found' });
    }

    await permission.destroy();
    res.json({ success: true, message: 'Permission removed successfully' });
  } catch (error) {
    console.error('Remove permission error:', error);
    res.status(500).json({ error: 'Failed to remove permission' });
  }
});

// Get user roles
router.get('/roles', authenticateToken, async (req, res) => {
  try {
    const roles = [
      { id: 'owner', name: 'Owner', description: 'Full system access' },
      { id: 'admin', name: 'Administrator', description: 'System management' },
      { id: 'manager', name: 'Manager', description: 'Team management' },
      { id: 'client', name: 'Client', description: 'Order management' },
      { id: 'worker', name: 'Worker', description: 'Task execution' }
    ];

    res.json({ roles });
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ error: 'Failed to get roles' });
  }
});

// Update user role
router.put('/users/:id/role', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // Only owners can update user roles
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can update user roles' });
    }

    const validRoles = ['owner', 'admin', 'manager', 'client', 'worker'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.role = role;
    await user.save();

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Check permissions for specific resource
router.post('/permissions/check', authenticateToken, async (req, res) => {
  try {
    const { resource, action } = req.body;
    const { id, role } = req.user;

    // Owners always have access
    if (role === 'owner') {
      return res.json({ hasPermission: true });
    }

    // Check if user has specific permission
    const permission = await Permission.findOne({
      where: {
        user_id: id,
        permission: action,
        resource
      }
    });

    res.json({ hasPermission: !!permission });
  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({ error: 'Failed to check permission' });
  }
});

// Get user accessible resources
router.get('/users/:id/resources', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Only owners can view other users' resources
    if (req.user.role !== 'owner' && req.user.id !== id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const user = await User.findByPk(id, {
      include: [
        {
          model: Permission,
          as: 'permissions',
          attributes: ['permission', 'resource']
        }
      ]
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const resources = {
      orders: false,
      users: false,
      analytics: false,
      files: false,
      settings: false
    };

    user.permissions.forEach(permission => {
      switch (permission.resource) {
        case 'orders':
          resources.orders = true;
          break;
        case 'users':
          resources.users = true;
          break;
        case 'analytics':
          resources.analytics = true;
          break;
        case 'files':
          resources.files = true;
          break;
        case 'settings':
          resources.settings = true;
          break;
      }
    });

    // Add role-based permissions
    switch (user.role) {
      case 'admin':
        resources.users = true;
        resources.settings = true;
        break;
      case 'manager':
        resources.orders = true;
        resources.analytics = true;
        break;
      case 'client':
        resources.orders = true;
        break;
      case 'worker':
        resources.orders = true;
        break;
    }

    res.json({
      userId: user.id,
      role: user.role,
      resources
    });
  } catch (error) {
    console.error('Get resources error:', error);
    res.status(500).json({ error: 'Failed to get resources' });
  }
});

// Get all permissions for admin view
router.get('/permissions/all', authenticateToken, async (req, res) => {
  try {
    // Only owners can view all permissions
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can view all permissions' });
    }

    const permissions = await Permission.findAll({
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'email', 'role']
        }
      ],
      order: [['created_at', 'DESC']]
    });

    res.json({
      total: permissions.length,
      permissions: permissions.map(p => ({
        id: p.id,
        userId: p.user_id,
        userEmail: p.user.email,
        userRole: p.user.role,
        permission: p.permission,
        resource: p.resource,
        createdAt: p.createdAt
      }))
    });
  } catch (error) {
    console.error('Get all permissions error:', error);
    res.status(500).json({ error: 'Failed to get all permissions' });
  }
});

export default router;
