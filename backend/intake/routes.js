const express = require('express');
const crypto = require('crypto');

const createIntakeRouter = ({
  ordersStorage,
  localRunnerEngine,
  pricing,
  listRequests,
  saveRequests,
  dbGet,
  sendOk,
  sendError
}) => {
  const router = express.Router();

  router.post('/request', async (req, res) => {
    try {
      const payload = req.body || {};
      const tenantId = Number(payload.tenantId);
      if (!Number.isFinite(tenantId) || tenantId <= 0) {
        return sendError(res, 400, 'Invalid input', 'tenantId is required');
      }
      const tenant = await dbGet('SELECT id, name FROM tenants WHERE id = ?', [tenantId]);
      if (!tenant) {
        return sendError(res, 404, 'Not Found', 'Tenant not found');
      }

      const nowIso = new Date().toISOString();
      const requestId = crypto.randomUUID();
      const orderId = crypto.randomUUID();
      const correlationId = `intake-${nowIso.replace(/[:.]/g, '')}-${orderId.slice(0, 8)}`;

      const serviceType = String(payload.serviceType || '').trim();
      const pickupAddress = String(payload.pickupAddress || payload.pickup || '').trim();
      const dropoffAddress = String(payload.dropoffAddress || payload.dropoff || '').trim();
      const timeWindow = String(payload.timeWindow || '').trim();
      const itemCategory = String(payload.itemCategory || '').trim();
      const itemValueEUR = Number(payload.itemValueEUR || 0);
      const contact = payload.contact || {};

      const quote = pricing.computePricing({
        distanceKm: payload.distanceKm || 5,
        urgency: payload.urgency || 'standard',
        storageDays: payload.storageDays || 0
      });

      const order = {
        id: orderId,
        tenantId,
        correlationId,
        createdAt: nowIso,
        updatedAt: nowIso,
        customer: {
          name: contact.name || null,
          email: contact.email || null,
          phone: contact.phone || null,
          preferredChannel: contact.preferredChannel || null
        },
        pickup: {
          address: pickupAddress,
          timeWindow: timeWindow || null,
          notes: null
        },
        dropoff: {
          address: dropoffAddress || null,
          timeWindow: timeWindow || null,
          notes: null
        },
        items: {
          category: itemCategory || null,
          valueEUR: Number.isFinite(itemValueEUR) ? itemValueEUR : null
        },
        service: {
          type: serviceType || 'pickup',
          urgency: payload.urgency || 'standard',
          storageDays: payload.storageDays || 0
        },
        pricing: { ...quote },
        status: 'awaiting_payment',
        payment: {
          mode: 'mock',
          state: 'unpaid'
        },
        proofs: [],
        questions: []
      };

      const requests = await listRequests();
      const requestRecord = {
        id: requestId,
        tenantId,
        orderId,
        correlationId,
        serviceType,
        pickupAddress,
        dropoffAddress,
        timeWindow,
        itemCategory,
        itemValueEUR: Number.isFinite(itemValueEUR) ? itemValueEUR : null,
        contact,
        createdAt: nowIso,
        questions: []
      };
      requests.unshift(requestRecord);
      await saveRequests(requests);

      const tenantOrders = await ordersStorage.listOrders(tenantId);
      tenantOrders.unshift(order);
      await ordersStorage.saveOrders(tenantId, tenantOrders);

      const updatedOrder = await localRunnerEngine.runPipeline({
        order,
        tenantId,
        userId: 0,
        reason: 'intake_request'
      });
      const refreshedOrders = await ordersStorage.listOrders(tenantId);
      const orderIndex = refreshedOrders.findIndex((item) => item.id === orderId);
      if (orderIndex >= 0) {
        refreshedOrders[orderIndex] = { ...updatedOrder, updatedAt: new Date().toISOString() };
        await ordersStorage.saveOrders(tenantId, refreshedOrders);
      }

      requestRecord.questions = updatedOrder.questions || [];
      await saveRequests(requests);

      return sendOk(res, {
        requestId,
        orderId,
        correlationId,
        quote
      });
    } catch (error) {
      console.error('Intake request error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to create intake request');
    }
  });

  return router;
};

module.exports = { createIntakeRouter };
