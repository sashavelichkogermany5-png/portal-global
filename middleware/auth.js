const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { User } = require('../database/models');
const logger = require('./logger');

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Middleware for authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      ok: false, 
      error: 'Access token required', 
      message: 'Authorization header is missing' 
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      logger.error('Token verification failed', { error: err.message });
      return res.status(403).json({ 
        ok: false, 
        error: 'Invalid token', 
        message: 'Token is invalid or expired' 
      });
    }
    req.user = user;
    next();
  });
};

// Middleware for role-based access control
const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        ok: false, 
        error: 'Unauthorized', 
        message: 'User not authenticated' 
      });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Unauthorized access attempt', { userId: req.user.id, role: req.user.role, requiredRoles: roles });
      return res.status(403).json({ 
        ok: false, 
        error: 'Forbidden', 
        message: 'Insufficient permissions' 
      });
    }
    next();
  };
};

// Register new user
const registerUser = async (req, res) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    
    // Validation
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Validation error', 
        message: 'Email, password, first name, and last name are required' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ 
        ok: false, 
        error: 'User already exists', 
        message: 'A user with this email already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: role || 'client'
    });

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logger.info('User registered successfully', { userId: user.id, email: user.email });

    res.status(201).json({
      ok: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (error) {
    logger.error('Registration error', { error: error.message });
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error', 
      message: 'Failed to register user' 
    });
  }
};

// Login user
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Validation error', 
        message: 'Email and password are required' 
      });
    }

    // Find user
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ 
        ok: false, 
        error: 'Invalid credentials', 
        message: 'Invalid email or password' 
      });
    }

    // Compare password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ 
        ok: false, 
        error: 'Invalid credentials', 
        message: 'Invalid email or password' 
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logger.info('User logged in successfully', { userId: user.id, email: user.email });

    res.json({
      ok: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (error) {
    logger.error('Login error', { error: error.message });
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error', 
      message: 'Failed to login user' 
    });
  }
};

// Get current user info
const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'email', 'firstName', 'lastName', 'role', 'avatar', 'createdAt', 'updatedAt']
    });

    if (!user) {
      return res.status(404).json({ 
        ok: false, 
        error: 'User not found', 
        message: 'User not found' 
      });
    }

    logger.info('User info retrieved', { userId: user.id });

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    logger.error('Get user error', { error: error.message });
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error', 
      message: 'Failed to get user info' 
    });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, avatar } = req.body;
    
    // Validation
    if (!firstName || !lastName) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Validation error', 
        message: 'First name and last name are required' 
      });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ 
        ok: false, 
        error: 'User not found', 
        message: 'User not found' 
      });
    }

    // Update user
    user.firstName = firstName;
    user.lastName = lastName;
    if (avatar) user.avatar = avatar;
    await user.save();

    logger.info('User profile updated', { userId: user.id });

    res.json({
      ok: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (error) {
    logger.error('Update profile error', { error: error.message });
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error', 
      message: 'Failed to update profile' 
    });
  }
};

// Change password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Validation error', 
        message: 'Current password and new password are required' 
      });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ 
        ok: false, 
        error: 'User not found', 
        message: 'User not found' 
      });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ 
        ok: false, 
        error: 'Invalid current password', 
        message: 'Current password is incorrect' 
      });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    logger.info('Password changed successfully', { userId: user.id });

    res.json({
      ok: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Change password error', { error: error.message });
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error', 
      message: 'Failed to change password' 
    });
  }
};

module.exports = {
  authenticateToken,
  authorizeRole,
  registerUser,
  loginUser,
  getCurrentUser,
  updateProfile,
  changePassword
};