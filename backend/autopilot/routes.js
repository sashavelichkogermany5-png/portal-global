const express = require('express');

const AUTOPILOT_ENABLED = process.env.AUTOPILOT_ENABLED === '1' || process.env.AUTOPILOT_ENABLED === 'true';

const createAutopilotRouter = ({ engine, storage, sendOk, sendError, logAudit, normalizeEmail, requireRole, requirePlan }) => {
    const router = express.Router();
    const requireAdmin = typeof requireRole === 'function'
        ? requireRole('admin')
        : (req, res, next) => next();
    const requireAutopilotLimit = typeof requirePlan === 'function'
        ? requirePlan('autopilot', 1)
        : (req, res, next) => next();

    const checkAutopilotEnabled = (req, res, next) => {
        if (!AUTOPILOT_ENABLED) {
            return sendError(res, 403, 'Forbidden', 'Autopilot is not enabled. Set AUTOPILOT_ENABLED=1 to enable.');
        }
        next();
    };

  router.post('/enable', checkAutopilotEnabled, requireAdmin, async (req, res) => {
    try {
      const enabled = Boolean(req.body?.enabled);
      const settings = await storage.updateTenantSettings(req.tenantId, { enabled });
      await logAudit({
        userId: req.user.id,
        tenantId: req.tenantId,
        entity: 'autopilot',
        action: enabled ? 'enable' : 'disable',
        entityId: req.tenantId
      });
      return sendOk(res, { tenantId: req.tenantId, enabled: settings.enabled });
    } catch (error) {
      console.error('Autopilot enable error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to update autopilot settings');
    }
  });

  router.get('/status', async (req, res) => {
    try {
      const settings = await storage.getTenantSettings(req.tenantId);
      return sendOk(res, {
        tenantId: req.tenantId,
        enabled: settings.enabled,
        mode: String(process.env.AUTOPILOT_MODE || 'local').toLowerCase(),
        intervalMin: Number(process.env.AUTOPILOT_INTERVAL_MIN || 60),
        paymentMode: String(process.env.PAYMENT_MODE || 'mock').toLowerCase(),
        lastRunAt: settings.lastRunAt || null,
        lastCorrelationId: settings.lastCorrelationId || null,
        settings: {
          preferredLanguage: settings.preferredLanguage,
          region: settings.region,
          primaryOfferTemplate: settings.primaryOfferTemplate,
          userApprovalRequired: settings.userApprovalRequired
        }
      });
    } catch (error) {
      console.error('Autopilot status error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load autopilot status');
    }
  });

  router.post('/tick', checkAutopilotEnabled, requireAdmin, requireAutopilotLimit, async (req, res) => {
    try {
      const result = await engine.runCycle({
        tenantId: req.tenantId,
        userId: req.user.id,
        tenantName: req.tenant?.name || null,
        reason: 'manual'
      });
      if (!result.ok) {
        return sendError(res, 500, 'Autopilot error', 'Autopilot cycle failed');
      }
      return sendOk(res, { tenantId: req.tenantId, correlationId: result.correlationId });
    } catch (error) {
      console.error('Autopilot tick error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to run autopilot cycle');
    }
  });

  router.get('/offers', async (req, res) => {
    try {
      const [offers, landings] = await Promise.all([
        storage.listOffers(req.tenantId),
        storage.listLandings(req.tenantId)
      ]);
      const enriched = offers.map((offer) => ({
        ...offer,
        landing: landings.find((landing) => landing.offerId === offer.id) || null
      }));
      return sendOk(res, enriched);
    } catch (error) {
      console.error('Autopilot offers error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load offers');
    }
  });

  router.post('/offers', async (req, res) => {
    try {
      const payload = req.body || {};
      const offers = await storage.listOffers(req.tenantId);
      const nowIso = new Date().toISOString();
      let offer = null;
      if (payload.id) {
        offer = offers.find((item) => item.id === payload.id);
      }
      if (!offer) {
        offer = {
          id: payload.id || require('crypto').randomUUID(),
          tenantId: req.tenantId,
          createdAt: nowIso
        };
        offers.push(offer);
      }
      offer.title = String(payload.title || offer.title || '').trim();
      offer.promise = String(payload.promise || offer.promise || '').trim();
      offer.price = Number(payload.price || offer.price || 0);
      offer.audience = String(payload.audience || offer.audience || '').trim();
      offer.deliveryType = String(payload.deliveryType || offer.deliveryType || '').trim();
      offer.status = String(payload.status || offer.status || 'draft');
      offer.updatedAt = nowIso;
      await storage.saveOffers(req.tenantId, offers);
      await logAudit({
        userId: req.user.id,
        tenantId: req.tenantId,
        entity: 'autopilot_offer',
        action: payload.id ? 'update' : 'create',
        entityId: offer.id
      });
      return sendOk(res, offer);
    } catch (error) {
      console.error('Autopilot offer save error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to save offer');
    }
  });

  router.get('/leads', async (req, res) => {
    try {
      const leads = await storage.listLeads(req.tenantId);
      return sendOk(res, leads);
    } catch (error) {
      console.error('Autopilot leads error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load leads');
    }
  });

  router.post('/leads/capture', async (req, res) => {
    try {
      const payload = req.body || {};
      const email = normalizeEmail(payload.email || '');
      if (!email || !email.includes('@')) {
        return sendError(res, 400, 'Invalid input', 'Email is required');
      }
      const name = String(payload.name || '').trim();
      const source = String(payload.source || 'landing').trim();
      const tags = Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : [];
      const lead = {
        id: require('crypto').randomUUID(),
        tenantId: req.tenantId,
        email,
        name,
        source,
        status: 'new',
        tags,
        offerId: payload.offerId || null,
        createdAt: new Date().toISOString()
      };
      const leads = await storage.listLeads(req.tenantId);
      leads.unshift(lead);
      await storage.saveLeads(req.tenantId, leads);
      await logAudit({
        userId: req.user.id,
        tenantId: req.tenantId,
        entity: 'autopilot_lead',
        action: 'create',
        entityId: lead.id
      });
      return sendOk(res, lead);
    } catch (error) {
      console.error('Autopilot lead capture error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to capture lead');
    }
  });

  router.get('/metrics', async (req, res) => {
    try {
      const metrics = await storage.listMetrics(req.tenantId);
      const summary = metrics.reduce((acc, item) => {
        acc.visits += Number(item.visits || 0);
        acc.leads += Number(item.leads || 0);
        acc.qualified += Number(item.qualified || 0);
        acc.paid += Number(item.paid || 0);
        acc.revenue += Number(item.revenue || 0);
        return acc;
      }, { visits: 0, leads: 0, qualified: 0, paid: 0, revenue: 0 });
      return sendOk(res, { summary, daily: metrics });
    } catch (error) {
      console.error('Autopilot metrics error:', error);
      return sendError(res, 500, 'Internal server error', 'Failed to load metrics');
    }
  });

  return router;
};

module.exports = { createAutopilotRouter };
