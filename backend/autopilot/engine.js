const crypto = require('crypto');
const path = require('path');
const { rankTemplates } = require('./scoring');

const toSafeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9\u0400-\u04ff]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60) || 'offer';

const formatDate = (date) => date.toISOString().slice(0, 10);

const buildCorrelationId = (date, tenantId) => {
  const stamp = date.toISOString().replace(/[-:]/g, '').slice(0, 12);
  return `autopilot-${stamp}-t${tenantId}`;
};

const buildOfferFromTemplate = (template, tenantId, status, nowIso) => {
  const basePrice = Array.isArray(template.priceTiers) && template.priceTiers.length
    ? Number(template.priceTiers[0].price) || 0
    : 0;
  return {
    id: crypto.randomUUID(),
    tenantId,
    title: template.title,
    promise: template.promise,
    price: basePrice,
    audience: template.audience,
    deliveryType: template.deliverable,
    status: status || 'draft',
    createdAt: nowIso,
    updatedAt: nowIso,
    templateId: template.id
  };
};

const buildLandingHtml = (offer, language = 'ru') => {
  const title = offer.title || 'Предложение';
  const promise = offer.promise || '';
  const audience = offer.audience || '';
  const price = offer.price ? `${offer.price} EUR` : '';
  const cta = language === 'ru' ? 'Оставить заявку' : 'Get access';
  const header = language === 'ru' ? 'Новый оффер' : 'New offer';
  return `<!doctype html>
<html lang="${language === 'ru' ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;background:#f7f8fb;color:#0f172a;margin:0;padding:24px}
    .card{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}
    h1{margin:0 0 12px;font-size:28px}
    p{line-height:1.6;color:#475569}
    .tag{display:inline-block;padding:4px 10px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:12px;font-weight:700;margin-bottom:12px}
    .price{font-size:20px;font-weight:700;color:#0f766e;margin:12px 0}
    form{display:grid;gap:12px;margin-top:18px}
    input,button{padding:10px 12px;border-radius:10px;border:1px solid #cbd5f5;font-size:14px}
    button{background:#0f766e;color:#fff;border:none;font-weight:700;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">${header}</div>
    <h1>${title}</h1>
    <p>${promise}</p>
    <p><strong>${audience}</strong></p>
    ${price ? `<div class="price">${price}</div>` : ''}
    <form method="post" action="/api/autopilot/leads/capture">
      <input type="hidden" name="offerId" value="${offer.id}" />
      <input type="text" name="name" placeholder="Имя" required />
      <input type="email" name="email" placeholder="Email" required />
      <button type="submit">${cta}</button>
    </form>
  </div>
</body>
</html>`;
};

const createAutopilotEngine = ({ storage, recordMessage, recordAction, logAudit }) => {
  const autopilotMode = String(process.env.AUTOPILOT_MODE || 'local').toLowerCase();
  const paymentMode = String(process.env.PAYMENT_MODE || 'mock').toLowerCase();

  const emit = async ({ tenantId, correlationId, sender, target, message, payload, severity }) => {
    await recordMessage({
      tenantId,
      correlationId,
      senderAgent: sender,
      targetAgent: target,
      role: 'agent',
      severity: severity || 'info',
      message,
      payload
    });
  };

  const queueDraftAction = async ({ tenantId, userId, correlationId, type, title, request }) => {
    const actionId = await recordAction({
      tenantId,
      userId,
      correlationId,
      actorAgent: 'RevenueAutopilot',
      actionType: type,
      status: 'draft',
      request: { title, ...request }
    });
    await emit({
      tenantId,
      correlationId,
      sender: 'ApprovalGate',
      target: 'User',
      message: `Черновик: ${title}`,
      payload: { type: 'draft_action', actionId, actionType: type, request }
    });
    return actionId;
  };

  const runCycle = async ({ tenantId, userId, tenantName, reason }) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const correlationId = buildCorrelationId(now, tenantId);
    const settings = await storage.getTenantSettings(tenantId);
    const language = settings.preferredLanguage || 'ru';

    try {
      await emit({
        tenantId,
        correlationId,
        sender: 'EventNormalizer',
        target: 'Router',
        message: `Автопилот: запуск цикла (${reason || 'scheduled'}).`,
        payload: { mode: autopilotMode, paymentMode, tenantName: tenantName || null }
      });

      await emit({
        tenantId,
        correlationId,
        sender: 'Router',
        target: 'RevenueAutopilot',
        message: 'Маршрут: RevenueAutopilot pipeline.',
        payload: { step: 'Router' }
      });

      await emit({
        tenantId,
        correlationId,
        sender: 'RevenueAutopilot',
        target: 'OfferBuilder',
        message: 'Планирование: проверяю активный оффер и эксперименты.',
        payload: { step: 'Planner' }
      });

      const templates = await storage.loadTemplates();
      const rankedTemplates = rankTemplates(Array.isArray(templates) ? templates : [], settings);
      const offers = await storage.listOffers(tenantId);
      let activeOffer = offers.find((offer) => offer.status === 'active');
      const createdOffers = [];

      if (!activeOffer) {
        const selectedTemplates = rankedTemplates.slice(0, 3);
        selectedTemplates.forEach((template, index) => {
          const status = index === 0 ? 'active' : 'draft';
          const offer = buildOfferFromTemplate(template, tenantId, status, nowIso);
          createdOffers.push(offer);
          offers.push(offer);
          if (status === 'active') {
            activeOffer = offer;
          }
        });
        await storage.saveOffers(tenantId, offers);
      }

      if (activeOffer) {
        activeOffer.updatedAt = nowIso;
        await storage.saveOffers(tenantId, offers);
      }

      await emit({
        tenantId,
        correlationId,
        sender: 'OfferBuilder',
        target: 'RevenueAutopilot',
        message: activeOffer
          ? `Оффер активен: ${activeOffer.title}.`
          : 'Нет активного оффера, требуется ручное создание.',
        payload: { created: createdOffers.map((offer) => offer.id), activeOfferId: activeOffer?.id || null }
      });

      const landings = await storage.listLandings(tenantId);
      let landing = activeOffer
        ? landings.find((item) => item.offerId === activeOffer.id)
        : null;
      if (activeOffer) {
        const slugBase = slugify(activeOffer.title);
        const slug = `${slugBase}-${tenantId}`;
        const html = buildLandingHtml(activeOffer, language);
        if (!landing) {
          landing = {
            id: crypto.randomUUID(),
            tenantId,
            offerId: activeOffer.id,
            slug,
            html,
            status: 'active',
            createdAt: nowIso,
            updatedAt: nowIso
          };
          landings.push(landing);
        } else {
          landing.slug = slug;
          landing.html = html;
          landing.status = 'active';
          landing.updatedAt = nowIso;
        }
        await storage.saveLandings(tenantId, landings);
      }

      await emit({
        tenantId,
        correlationId,
        sender: 'LandingBuilder',
        target: 'LeadOps',
        message: landing
          ? `Лендинг обновлен: /autopilot/${landing.slug}`
          : 'Лендинг не создан (нет активного оффера).',
        payload: { landingId: landing?.id || null, slug: landing?.slug || null }
      });

      const leads = await storage.listLeads(tenantId);
      const newLeads = leads.filter((lead) => lead.status === 'new').length;
      const qualifiedLeads = leads.filter((lead) => lead.status === 'qualified').length;
      const paidLeads = leads.filter((lead) => lead.status === 'paid').length;

      await emit({
        tenantId,
        correlationId,
        sender: 'LeadOps',
        target: 'Metrics',
        message: `Лиды: всего ${leads.length}, новых ${newLeads}, квалифицированных ${qualifiedLeads}.`,
        payload: { total: leads.length, new: newLeads, qualified: qualifiedLeads, paid: paidLeads }
      });

      await emit({
        tenantId,
        correlationId,
        sender: 'RevenueAutopilot',
        target: 'LeadOps',
        message: 'Нёрчер: подготовлены черновики. Checkout-ready требует ручного подтверждения оплаты.',
        payload: { step: 'Nurture' }
      });

      const experiments = await storage.listExperiments(tenantId);
      if (activeOffer && !experiments.find((exp) => exp.offerId === activeOffer.id && exp.status === 'active')) {
        experiments.push({
          id: crypto.randomUUID(),
          tenantId,
          offerId: activeOffer.id,
          hypothesis: 'Уточнить позиционирование повысит конверсию на 20%.',
          channel: 'органика',
          metricTarget: 'CR > 2%',
          status: 'active',
          createdAt: nowIso
        });
        await storage.saveExperiments(tenantId, experiments);
      }

      const activeExperiment = activeOffer
        ? experiments.find((exp) => exp.offerId === activeOffer.id && exp.status === 'active')
        : null;
      if (activeExperiment) {
        await emit({
          tenantId,
          correlationId,
          sender: 'RevenueAutopilot',
          target: 'Metrics',
          message: `Эксперимент: ${activeExperiment.hypothesis} (канал: ${activeExperiment.channel}).`,
          payload: { experimentId: activeExperiment.id }
        });
      }

      const metricsList = await storage.listMetrics(tenantId);
      const today = formatDate(now);
      let todayMetrics = metricsList.find((item) => item.date === today);
      if (!todayMetrics) {
        todayMetrics = {
          tenantId,
          date: today,
          visits: 0,
          leads: 0,
          qualified: 0,
          paid: 0,
          revenue: 0
        };
        metricsList.push(todayMetrics);
      }

      if (autopilotMode === 'local') {
        const seed = toSafeInt(today.replace(/-/g, ''), 0) + toSafeInt(tenantId, 0);
        const visitDelta = 20 + (seed % 15);
        const leadDelta = Math.max(1, Math.floor(visitDelta / 8));
        todayMetrics.visits += visitDelta;
        todayMetrics.leads += leadDelta;
      }
      todayMetrics.qualified = qualifiedLeads;
      todayMetrics.paid = paidLeads;
      const revenuePrice = activeOffer?.price || 0;
      todayMetrics.revenue = Number((paidLeads * revenuePrice).toFixed(2));

      await storage.saveMetrics(tenantId, metricsList);

      await emit({
        tenantId,
        correlationId,
        sender: 'Metrics',
        target: 'ApprovalGate',
        message: `Метрики: визиты ${todayMetrics.visits}, лиды ${todayMetrics.leads}, выручка ${todayMetrics.revenue} EUR.`,
        payload: { metrics: todayMetrics }
      });

      await queueDraftAction({
        tenantId,
        userId,
        correlationId,
        type: 'safe_send_email_draft',
        title: 'Черновик письма для прогрева лидов',
        request: {
          offerId: activeOffer?.id || null,
          language,
          requiresApproval: true
        }
      });

      await queueDraftAction({
        tenantId,
        userId,
        correlationId,
        type: 'safe_post_draft',
        title: 'Черновик поста для привлечения трафика',
        request: {
          offerId: activeOffer?.id || null,
          channel: 'community',
          requiresApproval: true
        }
      });

      await emit({
        tenantId,
        correlationId,
        sender: 'RevenueAutopilot',
        target: 'User',
        message: 'План дня: утвердить черновики (email, пост), проверить лендинг, подключить оплату при готовности.',
        payload: { step: 'DailyPlan' }
      });

      await emit({
        tenantId,
        correlationId,
        sender: 'ApprovalGate',
        target: 'RevenueAutopilot',
        message: 'Гейт утверждения: требуется проверить черновики.',
        payload: { approvals: true }
      });

      const hasStripe = Boolean(process.env.STRIPE_SECRET_KEY);
      const hasPaypal = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
      if (paymentMode !== 'mock' && ((paymentMode === 'stripe' && hasStripe) || (paymentMode === 'paypal' && hasPaypal))) {
        await queueDraftAction({
          tenantId,
          userId,
          correlationId,
          type: 'safe_payment_setup_draft',
          title: `Черновик подключения оплаты (${paymentMode})`,
          request: { provider: paymentMode, requiresApproval: true }
        });
        await emit({
          tenantId,
          correlationId,
          sender: 'PaymentProviderDraft',
          target: 'RevenueAutopilot',
          message: `Подготовлен черновик интеграции оплаты (${paymentMode}).`
        });
      } else {
        await emit({
          tenantId,
          correlationId,
          sender: 'PaymentProviderDraft',
          target: 'RevenueAutopilot',
          message: paymentMode === 'mock'
            ? 'Платежи в режиме mock. Интеграция не выполняется.'
            : 'Ключи платежей не настроены. Требуется вручную добавить env.'
        });
      }

      await queueDraftAction({
        tenantId,
        userId,
        correlationId,
        type: 'safe_write_file',
        title: 'Черновик плана доставки услуги',
        request: {
          path: path.join('docs', 'autopilot', `delivery-${activeOffer?.id || 'draft'}.md`),
          content: `# План доставки\n\nОффер: ${activeOffer?.title || 'n/a'}\nДата: ${nowIso}\n\n- Шаг 1: Бриф\n- Шаг 2: Драфт\n- Шаг 3: Финал\n`,
          requiresApproval: true
        }
      });

      await emit({
        tenantId,
        correlationId,
        sender: 'DeliveryDraft',
        target: 'RevenueAutopilot',
        message: 'Сформирован черновик плана доставки услуги.'
      });

      await emit({
        tenantId,
        correlationId,
        sender: 'PostMortem',
        target: 'User',
        message: 'Цикл автопилота завершен. Проверьте черновики и утвердите действия.'
      });

      await storage.updateTenantSettings(tenantId, {
        lastRunAt: nowIso,
        lastCorrelationId: correlationId
      });

      await logAudit({
        userId,
        tenantId,
        entity: 'autopilot',
        action: 'cycle',
        entityId: tenantId,
        meta: { correlationId }
      });

      return { ok: true, correlationId };
    } catch (error) {
      await emit({
        tenantId,
        correlationId,
        sender: 'RevenueAutopilot',
        target: 'User',
        severity: 'error',
        message: `Ошибка автопилота: ${error.message}`,
        payload: { error: error.message }
      });
      return { ok: false, correlationId, error };
    }
  };

  const shouldRunScheduler = () => toBoolean(process.env.AUTOPILOT_ENABLED, false);

  return {
    runCycle,
    shouldRunScheduler
  };
};

module.exports = { createAutopilotEngine };
