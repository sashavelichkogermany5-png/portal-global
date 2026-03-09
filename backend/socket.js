import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { authenticateToken } from './middleware/auth';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// WebSocket connection handling
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    socket.userRole = decoded.role;
    
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

// Store connected users
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.userId}`);
  
  // Add user to connected users map
  connectedUsers.set(socket.userId, {
    socketId: socket.id,
    role: socket.userRole,
    connectedAt: new Date()
  });

  // Send welcome message
  socket.emit('welcome', {
    message: 'Connected to PORTAL Global WebSocket server',
    timestamp: new Date().toISOString()
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.userId}`);
    connectedUsers.delete(socket.userId);
  });

  // Handle custom events
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.userId} joined room: ${roomId}`);
    
    // Notify other users in the room
    socket.to(roomId).emit('user_joined', {
      userId: socket.userId,
      role: socket.userRole,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('leave_room', (roomId) => {
    socket.leave(roomId);
    console.log(`User ${socket.userId} left room: ${roomId}`);
    
    // Notify other users in the room
    socket.to(roomId).emit('user_left', {
      userId: socket.userId,
      role: socket.userRole,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('send_message', (data) => {
    const { roomId, message, type = 'text' } = data;
    
    // Broadcast to all users in the room
    io.to(roomId).emit('receive_message', {
      senderId: socket.userId,
      senderRole: socket.userRole,
      message,
      type,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('typing', (roomId) => {
    // Notify other users in the room
    socket.to(roomId).emit('user_typing', {
      userId: socket.userId,
      role: socket.userRole,
      typing: true,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('stop_typing', (roomId) => {
    // Notify other users in the room
    socket.to(roomId).emit('user_typing', {
      userId: socket.userId,
      role: socket.userRole,
      typing: false,
      timestamp: new Date().toISOString()
    });
  });

  // Order events
  socket.on('order_created', (orderData) => {
    console.log('Order created:', orderData);
    
    // Broadcast to all connected clients
    io.emit('new_order', {
      ...orderData,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('order_updated', (orderData) => {
    console.log('Order updated:', orderData);
    
    // Broadcast to all connected clients
    io.emit('order_update', {
      ...orderData,
      timestamp: new Date().toISOString()
    });
  });

  // Payment events
  socket.on('payment_processed', (paymentData) => {
    console.log('Payment processed:', paymentData);
    
    // Broadcast to all connected clients
    io.emit('payment_processed', {
      ...paymentData,
      timestamp: new Date().toISOString()
    });
  });

  // Compliance events
  socket.on('compliance_issue', (complianceData) => {
    console.log('Compliance issue:', complianceData);
    
    // Broadcast to all connected clients
    io.emit('compliance_issue', {
      ...complianceData,
      timestamp: new Date().toISOString()
    });
  });

  // Worker status updates
  socket.on('worker_status_update', (workerData) => {
    console.log('Worker status update:', workerData);
    
    // Broadcast to all connected clients
    io.emit('worker_status', {
      ...workerData,
      timestamp: new Date().toISOString()
    });
  });

  // Revenue updates
  socket.on('revenue_update', (revenueData) => {
    console.log('Revenue update:', revenueData);
    
    // Broadcast to all connected clients
    io.emit('revenue_update', {
      ...revenueData,
      timestamp: new Date().toISOString()
    });
  });

  // Custom notifications
  socket.on('send_notification', (notificationData) => {
    console.log('Custom notification:', notificationData);
    
    // Broadcast to all connected clients
    io.emit('custom_notification', {
      ...notificationData,
      timestamp: new Date().toISOString()
    });
  });

  // Handle ping/pong for connection health
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });
});

// API endpoint to get connected users
app.get('/api/websocket/connected-users', authenticateToken, (req, res) => {
  const users = Array.from(connectedUsers.values());
  res.json({
    total: users.length,
    users
  });
});

// API endpoint to broadcast message
app.post('/api/websocket/broadcast', authenticateToken, (req, res) => {
  const { message, type = 'info', target = 'all' } = req.body;
  
  const broadcastData = {
    message,
    type,
    sender: req.user.email,
    timestamp: new Date().toISOString()
  };

  if (target === 'all') {
    io.emit('broadcast_message', broadcastData);
  } else if (target === 'owners') {
    io.emit('broadcast_message', broadcastData, (socket) => {
      return socket.userRole === 'owner';
    });
  } else if (target === 'admins') {
    io.emit('broadcast_message', broadcastData, (socket) => {
      return socket.userRole === 'admin';
    });
  }

  res.json({ success: true, message: 'Broadcast sent' });
});

// Start WebSocket server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

export { io, connectedUsers };
