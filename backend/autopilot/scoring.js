const scoreTemplate = (template, settings = {}) => {
  let score = 50;
  const primary = settings.primaryOfferTemplate ? String(settings.primaryOfferTemplate) : '';
  if (primary && (template.id === primary || template.title === primary)) {
    score += 40;
  }
  const region = settings.region ? String(settings.region).toLowerCase() : '';
  if (region && template.title && template.title.toLowerCase().includes(region)) {
    score += 5;
  }
  const language = settings.preferredLanguage ? String(settings.preferredLanguage).toLowerCase() : '';
  if (language === 'ru') {
    score += 5;
  }
  if (Array.isArray(template.priceTiers) && template.priceTiers.length >= 3) {
    score += 5;
  }
  return score;
};

const rankTemplates = (templates = [], settings = {}) => templates
  .map((template) => ({
    template,
    score: scoreTemplate(template, settings)
  }))
  .sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.template.id).localeCompare(String(b.template.id));
  })
  .map((item) => item.template);

module.exports = { scoreTemplate, rankTemplates };
