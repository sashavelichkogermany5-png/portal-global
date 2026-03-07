const fs = require('fs');
const path = require('path');

const CASES_PATH = path.join(__dirname, '..', 'docs', 'pmas-cases.json');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'pmas-report.md');

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const renderCase = (item, index) => {
  const lines = [];
  lines.push(`## ${index + 1}. ${item.title}`);
  lines.push('');
  lines.push(`Problem: ${item.problem}`);
  lines.push('');
  lines.push('Fitness:');
  item.fitness.forEach((f) => lines.push(`- ${f}`));
  lines.push('');
  lines.push('Varianten:');
  item.variants.forEach((v) => lines.push(`- ${v}`));
  lines.push('');
  lines.push('Fakten-check:');
  item.facts.forEach((f) => lines.push(`- ${f}`));
  lines.push('');
  lines.push('Stress-test:');
  lines.push(`- S1: F1=${item.scenarios.S1.F1} F2=${item.scenarios.S1.F2} F3=${item.scenarios.S1.F3}`);
  lines.push(`- S2: F1=${item.scenarios.S2.F1} F2=${item.scenarios.S2.F2} F3=${item.scenarios.S2.F3}`);
  lines.push(`- S3: F1=${item.scenarios.S3.F1} F2=${item.scenarios.S3.F2} F3=${item.scenarios.S3.F3}`);
  lines.push('');
  lines.push(`Selektion: победитель ${item.selection.winner}, второй ${item.selection.runnerUp}`);
  lines.push(`Kreuzung: ${item.crossover}`);
  lines.push(`Result: ${item.result}`);
  lines.push('');
  return lines.join('\n');
};

const run = () => {
  const cases = readJson(CASES_PATH);
  const out = [];
  out.push('# P-M-A-S — отчёт');
  out.push('');
  out.push(`Сгенерировано: ${new Date().toISOString()}`);
  out.push('');
  cases.forEach((item, index) => {
    out.push(renderCase(item, index));
  });
  fs.writeFileSync(OUT_PATH, out.join('\n'), 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
};

run();
