const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const createLocalRunnerRouter = ({
  storage,
  engine,
  computePricing,
  sendOk,
  sendError,
  logAudit,
  recordMessage,
  recordAction,
  requireRole
}) => {
  const router = express.Router();
  const paypalLink = String(process.env.PAYPAL_ME_LINK || '').trim().replace(/\/$/, '');

  const findOrder = async (tenantId, orderId) => {
    const orders = await storage.listOrders(tenantId);
    const order = orders.find((item) => item.id === orderId);
    return { orders, order };
  };

  router.post('/orders/create', requireRole(['admin', 'dispatcher']), async (req, res) => {
    try {
      const payload = req.body || {};
      const nowIso = new Date().toISOString();
      const orderId = crypto.randomUUID();
      const correlationId = `localrunner-${nowIso.replace(/[:.]/g, '')}-${orderId.slice(0, 8)}`;
      const quote = computePricing({
        distanceKm: payload.distanceKm || 5,
        urgency: payload.service?.urgency || payload.urgency || 'standard',
        storageDays: payload.service?.storageDays || 0
      });
      const order = {
        id: orderId,
        tenantId: req.tenantId,
        correlationId,
        createdAt: nowIso,
        updatedAt: nowIso,
        customer: payload.customer || {},
        pickup: payload.pickup || {},
        dropoff: payload.dropoff || {},
        items: payload.items || {},
        service: payload.service || { type: payload.serviceType || 'door_pickup', urgency: payload.urgency || 'standard' },
        pricing: quote,
        status: 'awaiting_payment',
        assignee: payload.assignee || {},
        proofs: [],
        payment: { mode: 'mock', state: 'unpaid' },
        questions: []
      };
      const orders = await storage.listOrders(req.tenantId);
      orders.unshift(order);
      await storage.saveOrders(req.tenantId, orders);
      const updatedOrder = await engine.runPipeline({
        order,
        tenantId: req.tenantId,
        userId: req.user.id,
        reason: 'create'
      });
      await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'local_runner_order', action: 'create', entityId: orderId });
      return sendOk(res, { orderId, correlationId, quote: updatedOrder.pricing });
    } catch (error) {
      console.error('Local runner create error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to create order');
    }
  });

  router.post('/orders/:id/intake', requireRole(['admin', 'dispatcher']), async (req, res) => {
    try {
      const orderId = req.params.id;
      const { orders, order } = await findOrder(req.tenantId, orderId);
      if (!order) return sendError(res, 404, 'Not Found', 'Order not found');
      const payload = req.body || {};
      order.pickup = { ...order.pickup, ...(payload.pickup || {}) };
      order.dropoff = { ...order.dropoff, ...(payload.dropoff || {}) };
      order.items = { ...order.items, ...(payload.items || {}) };
      order.customer = { ...order.customer, ...(payload.customer || {}) };
      order.service = { ...order.service, ...(payload.service || {}) };
      order.updatedAt = new Date().toISOString();
      await storage.saveOrders(req.tenantId, orders);
      const updatedOrder = await engine.runPipeline({
        order,
        tenantId: req.tenantId,
        userId: req.user.id,
        reason: 'intake'
      });
      await storage.saveOrders(req.tenantId, orders);
      return sendOk(res, updatedOrder);
    } catch (error) {
      console.error('Local runner intake error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to update order');
    }
  });

  router.get('/orders', requireRole(['admin', 'dispatcher', 'runner']), async (req, res) => {
    try {
      const status = String(req.query.status || '').trim();
      let orders = await storage.listOrders(req.tenantId);
      if (req.user.role === 'runner' && req.user.id) {
        orders = orders.filter((order) => order.assignee?.userId === req.user.id);
      }
      if (status) {
        orders = orders.filter((order) => order.status === status);
      }
      return sendOk(res, orders);
    } catch (error) {
      console.error('Local runner list error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load orders');
    }
  });

  router.get('/orders/:id', requireRole(['admin', 'dispatcher', 'runner']), async (req, res) => {
    try {
      const orderId = req.params.id;
      const { order } = await findOrder(req.tenantId, orderId);
      if (!order) return sendError(res, 404, 'Not Found', 'Order not found');
      return sendOk(res, order);
    } catch (error) {
      console.error('Local runner order fetch error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load order');
    }
  });

  router.post('/orders/:id/assign', requireRole(['admin', 'dispatcher']), async (req, res) => {
    try {
      const orderId = req.params.id;
      const runnerId = req.body?.runnerId;
      if (!runnerId) return sendError(res, 400, 'Invalid input', 'runnerId is required');
      const { orders, order } = await findOrder(req.tenantId, orderId);
      if (!order) return sendError(res, 404, 'Not Found', 'Order not found');
      const runners = await storage.listRunners(req.tenantId);
      const runner = runners.find((item) => item.id === runnerId);
      if (!runner) return sendError(res, 404, 'Not Found', 'Runner not found');
      order.assignee = { runnerId: runner.id, name: runner.name, userId: runner.userId || null };
      order.status = order.status === 'paid' ? 'assigned' : order.status;
      order.updatedAt = new Date().toISOString();
      await storage.saveOrders(req.tenantId, orders);
      await recordMessage({
        tenantId: req.tenantId,
        correlationId: order.correlationId,
        senderAgent: 'DispatchAgent',
        targetAgent: 'User',
        role: 'agent',
        severity: 'info',
        message: `Назначен исполнитель: ${runner.name}.`
      });
      await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'local_runner_order', action: 'assign', entityId: orderId });
      return sendOk(res, order);
    } catch (error) {
      console.error('Local runner assign error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to assign runner');
    }
  });

  router.post('/orders/:id/status', requireRole(['admin', 'dispatcher', 'runner']), async (req, res) => {
    try {
      const orderId = req.params.id;
      const status = String(req.body?.status || '').trim();
      if (!status) return sendError(res, 400, 'Invalid input', 'status is required');
      const { orders, order } = await findOrder(req.tenantId, orderId);
      if (!order) return sendError(res, 404, 'Not Found', 'Order not found');
      order.status = status;
      order.updatedAt = new Date().toISOString();
      await storage.saveOrders(req.tenantId, orders);
      await recordMessage({
        tenantId: req.tenantId,
        correlationId: order.correlationId,
        senderAgent: 'StatusAgent',
        targetAgent: 'User',
        role: 'agent',
        severity: 'info',
        message: `Статус обновлен: ${status}.`
      });
      await recordAction({
        tenantId: req.tenantId,
        userId: req.user.id,
        correlationId: order.correlationId,
        actorAgent: 'StatusAgent',
        actionType: 'localrunner_send_message_draft',
        status: 'draft',
        request: { orderId, status, message: `Обновление статуса: ${status}` }
      });
      await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'local_runner_order', action: 'status', entityId: orderId, meta: { status } });
      return sendOk(res, order);
    } catch (error) {
      console.error('Local runner status error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to update status');
    }
  });

  router.post('/orders/:id/proof', requireRole(['runner', 'admin', 'dispatcher']), upload.single('file'), async (req, res) => {
    try {
      const orderId = req.params.id;
      const { orders, order } = await findOrder(req.tenantId, orderId);
      if (!order) return sendError(res, 404, 'Not Found', 'Order not found');
      if (!req.file) {
        return sendError(res, 400, 'Invalid input', 'file is required');
      }
      const proofDir = path.join(__dirname, '..', '..', 'data', 'orders', 'proofs', orderId);
      await require('fs').promises.mkdir(proofDir, { recursive: true });
      const filename = `${Date.now()}-${req.file.originalname}`;
      const filePath = path.join(proofDir, filename);
      await require('fs').promises.writeFile(filePath, req.file.buffer);
      const proof = {
        id: crypto.randomUUID(),
        type: String(req.body?.type || 'proof'),
        note: String(req.body?.note || ''),
        file: `/data/orders/proofs/${orderId}/${filename}`,
        createdAt: new Date().toISOString()
      };
      engine.appendProof(order, proof);
      order.updatedAt = new Date().toISOString();
      await storage.saveOrders(req.tenantId, orders);
      await recordAction({
        tenantId: req.tenantId,
        userId: req.user.id,
        correlationId: order.correlationId,
        actorAgent: 'StatusAgent',
        actionType: 'localrunner_attach_proof',
        status: 'draft',
        request: { orderId, proof }
      });
      await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'local_runner_order', action: 'proof', entityId: orderId });
      return sendOk(res, proof);
    } catch (error) {
      console.error('Local runner proof error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to upload proof');
    }
  });

  router.post('/orders/:id/payment/mark-paid', requireRole(['admin']), async (req, res) => {
    try {
      const orderId = req.params.id;
      const { orders, order } = await findOrder(req.tenantId, orderId);
      if (!order) return sendError(res, 404, 'Not Found', 'Order not found');
      order.payment = { ...order.payment, state: 'paid' };
      order.status = 'paid';
      order.updatedAt = new Date().toISOString();
      await storage.saveOrders(req.tenantId, orders);
      await recordMessage({
        tenantId: req.tenantId,
        correlationId: order.correlationId,
        senderAgent: 'PaymentDraftAgent',
        targetAgent: 'User',
        role: 'agent',
        severity: 'info',
        message: 'Оплата подтверждена администратором.'
      });
      await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'local_runner_order', action: 'mark_paid', entityId: orderId });
      return sendOk(res, order);
    } catch (error) {
      console.error('Local runner mark paid error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to mark paid');
    }
  });

  router.post('/orders/:id/payment/paypal-link', requireRole(['admin', 'dispatcher']), async (req, res) => {
    try {
      const orderId = req.params.id;
      const { order } = await findOrder(req.tenantId, orderId);
      if (!order) return sendError(res, 404, 'Not Found', 'Order not found');
      if (!paypalLink) {
        return sendError(res, 400, 'Invalid state', 'PAYPAL_ME_LINK not configured');
      }
      const link = `${paypalLink}/${order.pricing?.totalEUR || 0}`;
      return sendOk(res, { link });
    } catch (error) {
      console.error('Local runner paypal link error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to generate link');
    }
  });

  router.get('/runners', requireRole(['admin', 'dispatcher']), async (req, res) => {
    try {
      const runners = await storage.listRunners(req.tenantId);
      return sendOk(res, runners);
    } catch (error) {
      console.error('Local runner list error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load runners');
    }
  });

  router.post('/runners', requireRole(['admin', 'dispatcher']), async (req, res) => {
    try {
      const payload = req.body || {};
      const runners = await storage.listRunners(req.tenantId);
      let runner = null;
      if (payload.id) {
        runner = runners.find((item) => item.id === payload.id);
      }
      if (!runner) {
        runner = { id: payload.id || crypto.randomUUID(), tenantId: req.tenantId };
        runners.push(runner);
      }
      runner.name = String(payload.name || runner.name || '').trim();
      runner.phone = String(payload.phone || runner.phone || '').trim();
      runner.active = payload.active !== undefined ? Boolean(payload.active) : (runner.active !== false);
      runner.capabilities = Array.isArray(payload.capabilities) ? payload.capabilities : (runner.capabilities || ['pickup', 'delivery']);
      runner.userId = payload.userId || runner.userId || null;
      await storage.saveRunners(req.tenantId, runners);
      await logAudit({ userId: req.user.id, tenantId: req.tenantId, entity: 'runner', action: payload.id ? 'update' : 'create', entityId: runner.id });
      return sendOk(res, runner);
    } catch (error) {
      console.error('Local runner save error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to save runner');
    }
  });

  router.get('/metrics', requireRole(['admin', 'dispatcher']), async (req, res) => {
    try {
      const metrics = await storage.listMetrics(req.tenantId);
      return sendOk(res, metrics);
    } catch (error) {
      console.error('Local runner metrics error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load metrics');
    }
  });

  return router;
};

module.exports = { createLocalRunnerRouter };
