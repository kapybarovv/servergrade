// Keep this explanation aligned with calculateScores in index.js. The stored
// category scores are sufficient to explain a total; they cannot establish which
// individual raw measurements produced a historical category score.
const CATEGORIES = [
  { key: "network", field: "network_score", weight: 30, ru: "Сеть", en: "Network" },
  { key: "performance", field: "performance_score", weight: 45, ru: "Производительность", en: "Performance" },
  { key: "quality", field: "quality_score", weight: 25, ru: "Качество IP", en: "IP quality" },
];

function score(value) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100 ? number : null;
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function bilingual(ru, en, tag = "span", className = "") {
  return `<${tag}${className ? ` class="${className}"` : ""} data-i18n-ru="${escape(ru)}" data-i18n-en="${escape(en)}">${escape(ru)}</${tag}>`;
}

/** Diagnostic model built only from the stored report summary, never a new score. */
export function buildScoreHelpModel(row = {}) {
  const record = row && typeof row === "object" ? row : {};
  const total = score(record.score);
  const categories = CATEGORIES.map((category) => ({ ...category, score: score(record[category.field]) }));
  let calculation = null;
  if (categories.every((category) => category.score !== null)) {
    const included = categories.filter((category) => category.score > 0);
    const weighted = included.reduce((sum, category) => sum + category.score * category.weight, 0);
    const totalWeight = included.reduce((sum, category) => sum + category.weight, 0);
    const calculated = totalWeight ? Math.trunc((weighted + totalWeight / 2) / totalWeight) : 0;
    calculation = { weighted, totalWeight, score: calculated, consistent: total !== null && total === calculated };
  }
  return { total, coverage: score(record.coverage), categories, calculation };
}

function renderTotal(model) {
  const heading = model.total === null
    ? bilingual("Итоговый рейтинг", "Overall score", "h3")
    : bilingual(`Итоговый рейтинг: ${model.total}/100`, `Overall score: ${model.total}/100`, "h3");
  const breakdown = model.categories.map((category) => {
    const ru = category.score === null ? "нет данных" : category.score === 0 ? "не измерено" : `${category.score}/100 · вес ${category.weight}%`;
    const en = category.score === null ? "no data" : category.score === 0 ? "not measured" : `${category.score}/100 · weight ${category.weight}%`;
    return `<div><dt>${bilingual(category.ru, category.en)}</dt><dd>${bilingual(ru, en)}</dd></div>`;
  }).join("");
  let formula;
  if (!model.calculation?.consistent) {
    formula = bilingual(
      "По сохранённой сводке нельзя точно восстановить этот итог. Старые отчёты могли использовать другую методику; ниже описаны текущие правила.",
      "The saved summary cannot reproduce this total exactly. Older reports may use a different method; the current rules are explained below.", "p");
  } else if (!model.calculation.totalWeight) {
    formula = bilingual("Категории не измерены. Итог 0 означает отсутствие оценённых данных.", "No categories were measured. A total of 0 means there is no scored data.", "p");
  } else {
    const expression = model.categories.filter((category) => category.score > 0).map((category) => `${category.score} × ${category.weight}`).join(" + ");
    formula = bilingual(
      `По сохранённым оценкам: (${expression}) ÷ ${model.calculation.totalWeight} → ${model.total}/100.`,
      `From the saved category scores: (${expression}) ÷ ${model.calculation.totalWeight} → ${model.total}/100.`, "p", "score-help-formula");
  }
  return `<section>${heading}<dl class="score-help-breakdown">${breakdown}</dl>${formula}${bilingual(
    "Базовые веса: сеть 30%, производительность 45%, качество IP 25%. Неизмеренные категории исключаются, а веса остальных нормируются. Оценки тестов и категорий усредняются с округлением вниз; итог округляется до ближайшего целого.",
    "Base weights: network 30%, performance 45%, IP quality 25%. Unmeasured categories are excluded and the remaining weights are normalized. Test and category averages are rounded down; the total is rounded to the nearest integer.", "p")}${bilingual(
    "Сеть — геолокация и доступность сервисов. Производительность — тесты скорости передачи данных, CPU и диска. Это оценка данного запуска, а не всех услуг хостинга.",
    "Network covers geolocation and service accessibility. Performance covers transfer speed, CPU and disk tests. This score describes this run, rather than every service offered by the host.", "p")}</section>`;
}

function renderQuality(model) {
  const quality = model.categories.find((category) => category.key === "quality").score;
  const missing = quality === 0
    ? bilingual("В этом отчёте качество IP не измерено.", "IP quality was not measured in this report.", "p")
    : quality === null ? bilingual("В сохранённой сводке нет оценки качества IP.", "The saved summary has no IP quality score.", "p") : "";
  return `<section>${bilingual("Что значит «Качество IP»", "What IP quality means", "h3")}${missing}${bilingual(
    "В эту категорию входят IP Check Place и IPQuality. Учитываются сохранённые отметки репутационных баз, уровень риска, DNSBL и статусы проверок. Оценки завершённых тестов имеют равный вес; пропущенные тесты и тесты с ошибкой исключаются.",
    "This category contains IP Check Place and IPQuality. It uses recorded reputation database signals, risk levels, DNSBL and check statuses. Completed tests have equal weight; skipped and failed tests are excluded.", "p")}${bilingual(
    "Для метрики «Риск»: Low / VeryLow → 100, Medium → 60, High / VeryHigh → 15, нераспознанное значение → 70. Для DNSBL: распознанный ноль → 100, любое другое значение → 20.",
    "For the Risk metric: Low / VeryLow → 100, Medium → 60, High / VeryHigh → 15, an unrecognized value → 70. For DNSBL: a parsed zero → 100, any other value → 20.", "p")}${bilingual(
    "Статусы сервисов ok / warn / bad дают 100 / 55 / 10. Их среднее входит в тест как один дополнительный сигнал наряду с метриками. Другие сохранённые метрики тоже могут влиять на оценку. Балл не является вероятностью мошенничества или гарантией доступа к сервисам.",
    "Service statuses ok / warn / bad contribute 100 / 55 / 10. Their average is one additional signal alongside the test metrics. Other recorded metrics may also affect the score. The score is not a fraud probability or a guarantee of access to services.", "p")}</section>`;
}

function renderCoverage(model) {
  const heading = model.coverage === null ? "Покрытие и полнота данных" : `Покрытие: ${model.coverage}%`;
  const englishHeading = model.coverage === null ? "Coverage and data completeness" : `Coverage: ${model.coverage}%`;
  return `<section>${bilingual(heading, englishHeading, "h3")}${bilingual(
    "Покрытие — доля завершённых тестов из 11, округлённая вниз. Оно отображается отдельно и не умножает итоговый рейтинг. Высокий балл при низком покрытии описывает только измеренные категории.",
    "Coverage is the percentage of the 11 tests completed, rounded down. It is shown separately and does not multiply the overall score. A high score with low coverage describes only the measured categories.", "p")}${bilingual(
    "В текущей методике завершённый тест без сохранённых метрик и учитываемых статусов получает запасное значение 60. Поэтому 60/100 само по себе не доказывает среднюю производительность. Одна сводка не позволяет определить причину каждого балла в старом отчёте.",
    "In the current method, a completed test with no recorded metrics or eligible statuses receives a fallback of 60. A score of 60/100 alone therefore does not establish average performance. A summary alone cannot explain every score in an older report.", "p")}</section>`;
}

/** One native disclosure: usable on touch and keyboard, without hover overlays. */
export function renderScoreHelp(row) {
  const model = buildScoreHelpModel(row);
  const sections = `${renderTotal(model)}${renderQuality(model)}${renderCoverage(model)}`;
  return `<details class="score-help"><summary><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/></svg>${bilingual("Откуда берутся баллы", "How scores are calculated")}<svg class="score-help-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><div class="score-help-body">${sections}</div></details>`;
}

export const scoreHelpStyles = `
.score-help{min-width:0;max-width:100%;margin:10px 0 24px;color:#9ca3a0;font:inherit}
.score-help>summary{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:fit-content;max-width:100%;min-height:44px;padding:6px 0;list-style:none;cursor:pointer;color:#c5ccc8;font-size:.82rem;line-height:1.4;touch-action:manipulation}
.score-help>summary::-webkit-details-marker{display:none}
.score-help>summary>span{min-width:0;overflow-wrap:anywhere}
.score-help>summary>svg{flex:none}
.score-help>summary:focus-visible{outline:2px solid #34d399;outline-offset:4px;border-radius:8px}
.score-help-chevron{transition:transform 160ms ease}
.score-help[open]>summary .score-help-chevron{transform:rotate(180deg)}
.score-help-body{box-sizing:border-box;display:grid;gap:20px;width:100%;max-width:72ch;padding:16px 0 0;border-top:1px solid #ffffff12}
.score-help-body section{min-width:0}
.score-help-body h3{margin:0 0 7px;color:#e0e5e2;font-size:.875rem;font-weight:600;line-height:1.5;overflow-wrap:anywhere}
.score-help-body p{margin:7px 0 0;font-size:.82rem;line-height:1.65;overflow-wrap:anywhere}
.score-help-breakdown{display:grid;gap:7px;margin:10px 0 12px;font-size:.82rem;line-height:1.5}
.score-help-breakdown>div{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}
.score-help-breakdown dt,.score-help-breakdown dd{min-width:0;margin:0;overflow-wrap:anywhere}
.score-help-breakdown dd{text-align:right;color:#c5ccc8;font-variant-numeric:tabular-nums}
.score-help-formula{color:#d0d8d3;font-variant-numeric:tabular-nums}
@media(hover:hover){.score-help>summary:hover{color:#fff}}
@media(prefers-reduced-motion:reduce){.score-help-chevron{transition:none}}
`;
