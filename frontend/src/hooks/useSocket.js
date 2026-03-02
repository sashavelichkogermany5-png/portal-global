import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom'';
import { useAuth } from '../hooks/useAuth'';

const SOCKET_SERVER_URL = process.env.REACT_APP_SOCKET_SERVER_URL || 'http://localhost:3001';

const useSocket = () => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const newSocket = io(SOCKET_SERVER_URL, {
      auth: { token: user.token },
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
      setSocket(newSocket);
    });

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    });

    newSocket.on('reconnect_attempt', () => {
      console.log('WebSocket reconnecting...');
    });

    newSocket.on('new_order', (data) => {
      console.log('New order received:', data);
      addNotification({
        type: 'info',
        title: 'New Order',
        message: `Order #${data.id}: ${data.description}`,
        timestamp: new Date().toISOString()
      });
    });

    newSocket.on('order_update', (data) => {
      console.log('Order updated:', data);
      addNotification({
        type: 'warning',
        title: 'Order Updated',
        message: `Order #${data.id} status changed to ${data.status}`,
        timestamp: new Date().toISOString()
      });
    });

    newSocket.on('payment_processed', (data) => {
      console.log('Payment processed:', data);
      addNotification({
        type: 'success',
        title: 'Payment Received',
        message: `Payment of ${data.amount} processed for order #${data.orderId}`,
        timestamp: new Date().toISOString()
      });
    });

    newSocket.on('compliance_issue', (data) => {
      console.log('Compliance issue:', data);
      addNotification({
        type: 'error',
        title: 'Compliance Alert',
        message: data.issue || 'Compliance issue detected',
        timestamp: new Date().toISOString()
      });
    });

    newSocket.on('error', (error) => {
      console.error('WebSocket error:', error);
      if (error.type === 'UnauthorizedError' || error.message.includes('jwt expired')) {
        navigate('/login');
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [isAuthenticated, user, navigate]);

  const addNotification = (notification) => {
    setNotifications(prev => [
      { id: Date.now(), ...notification },
      ...prev
    ]);

    // Keep only last 10 notifications
    if (notifications.length > 10) {
      setNotifications(prev => prev.slice(0, 10));
    }
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const emitEvent = (eventName, data) => {
    if (socket && connected) {
      socket.emit(eventName, data);
    }
  };

  return {
    connected,
    notifications,
    addNotification,
    clearNotifications,
    emitEvent
  };
};

export default useSocket;