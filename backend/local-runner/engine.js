const { computePricing } = require('./pricing');

const buildCorrelationId = (orderId) => `order-${orderId}`;

const normalizeContact = (contact = {}) => {
  const phone = contact.phone ? String(contact.phone).trim() : '';
  const email = contact.email ? String(contact.email).trim().toLowerCase() : '';
  return { phone, email };
};

const buildMissingQuestions = (order) => {
  const questions = [];
  if (!order.pickup?.address) {
    questions.push('Укажите адрес забора');
  }
  if (order.service?.type !== 'storage' && !order.dropoff?.address) {
    questions.push('Укажите адрес доставки');
  }
  if (!order.pickup?.timeWindow && !order.dropoff?.timeWindow) {
    questions.push('Укажите временное окно');
  }
  if (!order.items?.category || !order.items?.valueEUR) {
    questions.push('Укажите категорию и примерную стоимость');
  }
  if (!order.customer?.phone && !order.customer?.email) {
    questions.push('Укажите телефон или email для связи');
  }
  return questions.slice(0, 5);
};

const selectRunner = (runners, order) => {
  const active = runners.filter((runner) => runner.active);
  const needed = order.service?.type || 'pickup';
  const matched = active.find((runner) => Array.isArray(runner.capabilities) && runner.capabilities.includes(needed));
  return matched || active[0] || null;
};

const createLocalRunnerEngine = ({
  storage,
  recordMessage,
  recordAction,
  logAudit,
  paymentMode,
  paypalLink,
  stripeEnabled
}) => {
  const emit = async (payload) => recordMessage({
    tenantId: payload.tenantId,
    correlationId: payload.correlationId,
    senderAgent: payload.sender,
    targetAgent: payload.target,
    role: payload.role || 'agent',
    severity: payload.severity || 'info',
    message: payload.message,
    payload: payload.data
  });

  const draftAction = async ({ tenantId, userId, correlationId, type, title, request }) => {
    const actionId = await recordAction({
      tenantId,
      userId,
      correlationId,
      actorAgent: 'LocalRunner',
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
      data: { type: 'draft_action', actionId, actionType: type }
    });
    return actionId;
  };

  const runPipeline = async ({ order, tenantId, userId, reason }) => {
    const correlationId = order.correlationId || buildCorrelationId(order.id);
    order.correlationId = correlationId;

    const questions = buildMissingQuestions(order);
    await emit({
      tenantId,
      correlationId,
      sender: 'EventNormalizer',
      target: 'Router',
      message: `Local runner intake (${reason}).`,
      data: { orderId: order.id }
    });

    await emit({
      tenantId,
      correlationId,
      sender: 'Router',
      target: 'LocalRunner',
      message: 'Маршрут: Intake -> Pricing -> Payment -> Dispatch -> Status',
      data: { step: 'Router' }
    });

    if (questions.length) {
      order.questions = questions;
      await emit({
        tenantId,
        correlationId,
        sender: 'LocalRunner',
        target: 'User',
        message: `Нужны данные: ${questions.join('; ')}`,
        data: { questions }
      });
    } else {
      order.questions = [];
    }

    const distanceKm = Number.isFinite(Number(order.pricing?.distanceKm))
      ? Number(order.pricing.distanceKm)
      : (order.pricing?.distanceKm || 5);
    const urgency = order.service?.urgency || 'standard';
    const pricing = computePricing({ distanceKm, urgency, storageDays: order.service?.storageDays || 0 });
    order.pricing = { ...order.pricing, ...pricing };
    order.status = order.status || 'awaiting_payment';
    await emit({
      tenantId,
      correlationId,
      sender: 'PricingAgent',
      target: 'LocalRunner',
      message: `Цена рассчитана: ${pricing.totalEUR} EUR.`,
      data: pricing
    });

    if (paymentMode === 'paypal_link' && paypalLink) {
      const link = `${paypalLink}/${pricing.totalEUR}`;
      order.payment = {
        mode: 'paypal',
        state: order.payment?.state || 'unpaid',
        reference: link
      };
      await draftAction({
        tenantId,
        userId,
        correlationId,
        type: 'send_payment_link',
        title: 'Отправить ссылку на оплату PayPal',
        request: { link, orderId: order.id }
      });
    } else if (paymentMode === 'stripe_draft' && stripeEnabled) {
      order.payment = {
        mode: 'stripe',
        state: order.payment?.state || 'unpaid'
      };
      await draftAction({
        tenantId,
        userId,
        correlationId,
        type: 'create_stripe_checkout_session',
        title: 'Создать Stripe checkout (черновик)',
        request: { orderId: order.id, amount: pricing.totalEUR }
      });
    } else {
      order.payment = {
        mode: paymentMode === 'mock' ? 'mock' : 'mock',
        state: order.payment?.state || 'unpaid'
      };
      await draftAction({
        tenantId,
        userId,
        correlationId,
        type: 'mark_paid_mock',
        title: 'Подтвердить оплату (mock)',
        request: { orderId: order.id }
      });
    }

    const runners = await storage.listRunners(tenantId);
    const selectedRunner = selectRunner(runners, order);
    if (selectedRunner) {
      order.assignee = { runnerId: selectedRunner.id, name: selectedRunner.name };
      order.status = order.payment?.state === 'paid' ? 'assigned' : order.status;
      await emit({
        tenantId,
        correlationId,
        sender: 'DispatchAgent',
        target: 'LocalRunner',
        message: `Назначен исполнитель: ${selectedRunner.name}.`,
        data: { runnerId: selectedRunner.id }
      });
    } else {
      order.assignee = order.assignee || {};
      await draftAction({
        tenantId,
        userId,
        correlationId,
        type: 'localrunner_assign_runner',
        title: 'Назначить исполнителя',
        request: { orderId: order.id }
      });
      await emit({
        tenantId,
        correlationId,
        sender: 'DispatchAgent',
        target: 'LocalRunner',
        message: 'Нет доступного исполнителя. Требуется назначение вручную.'
      });
    }

    await emit({
      tenantId,
      correlationId,
      sender: 'StatusAgent',
      target: 'User',
      message: `Статус: ${order.status}.`
    });

    await emit({
      tenantId,
      correlationId,
      sender: 'PostMortem',
      target: 'User',
      message: 'Цикл обработки заказа завершен.'
    });

    await logAudit({ userId, tenantId, entity: 'local_runner', action: 'pipeline', entityId: order.id });
    return order;
  };

  const appendProof = (order, proof) => {
    order.proofs = Array.isArray(order.proofs) ? order.proofs : [];
    order.proofs.push(proof);
  };

  return {
    runPipeline,
    appendProof,
    buildCorrelationId
  };
};

module.exports = { createLocalRunnerEngine, buildCorrelationId, normalizeContact };
