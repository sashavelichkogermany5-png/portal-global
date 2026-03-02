const pricingConfig = {
  baseEUR: 9,
  perKmEUR: 1,
  urgencyFee: {
    standard: 0,
    same_day: 5,
    '60min': 12
  },
  storageFeePerDayEUR: 2,
  minimumTotalEUR: 19
};

const computePricing = ({ distanceKm, urgency, storageDays }) => {
  const km = Number.isFinite(Number(distanceKm)) ? Number(distanceKm) : 0;
  const urgencyKey = urgency && pricingConfig.urgencyFee[urgency] !== undefined ? urgency : 'standard';
  const urgencyFee = pricingConfig.urgencyFee[urgencyKey];
  const storageFee = Number.isFinite(Number(storageDays)) ? Number(storageDays) * pricingConfig.storageFeePerDayEUR : 0;
  const base = pricingConfig.baseEUR;
  const distanceFee = km * pricingConfig.perKmEUR;
  const rawTotal = base + distanceFee + urgencyFee + storageFee;
  const total = Math.max(pricingConfig.minimumTotalEUR, Number(rawTotal.toFixed(2)));
  const breakdown = [
    { label: 'Base', amountEUR: base },
    { label: `Distance (${km} km)`, amountEUR: Number(distanceFee.toFixed(2)) },
    { label: `Urgency (${urgencyKey})`, amountEUR: urgencyFee },
    { label: `Storage (${storageDays || 0} days)`, amountEUR: Number(storageFee.toFixed(2)) },
    { label: 'Minimum total', amountEUR: pricingConfig.minimumTotalEUR }
  ];
  return {
    baseEUR: base,
    distanceKm: km,
    urgencyFeeEUR: urgencyFee,
    storageFeeEUR: Number(storageFee.toFixed(2)),
    totalEUR: total,
    breakdown,
    minimumTotalEUR: pricingConfig.minimumTotalEUR
  };
};

module.exports = { computePricing, pricingConfig };
