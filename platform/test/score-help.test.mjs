import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { buildScoreHelpModel, renderScoreHelp, scoreHelpStyles } from "../src/score-help.js";

const row = { score: 70, network_score: 72, performance_score: 72, quality_score: 62, coverage: 90 };

test("stored category scores explain the total without applying coverage as a multiplier", () => {
  const model = buildScoreHelpModel(row);
  assert.deepEqual(model.calculation, { weighted: 6950, totalWeight: 100, score: 70, consistent: true });
  const html = renderScoreHelp(row);
  assert.match(html, /72 × 30 \+ 72 × 45 \+ 62 × 25/);
  assert.match(html, /÷ 100 → 70\/100/);
  assert.match(html, /Покрытие: 90%/);
  assert.match(html, /не умножает итоговый рейтинг/);
  assert.deepEqual(buildScoreHelpModel({ ...row, coverage: 9 }).calculation, model.calculation);
});

test("missing categories are excluded and remaining category weights are normalized", () => {
  const partial = { score: 62, network_score: 80, performance_score: 0, quality_score: 40, coverage: 18 };
  assert.deepEqual(buildScoreHelpModel(partial).calculation, { weighted: 3400, totalWeight: 55, score: 62, consistent: true });
  const html = renderScoreHelp(partial);
  assert.match(html, /80 × 30 \+ 40 × 25/);
  assert.doesNotMatch(html, /0 × 45/);
  assert.match(html, /not measured/);
  assert.match(html, /÷ 55 → 62\/100/);
});

test("zero and missing data are distinct; old mismatches never get a made-up numerical explanation", () => {
  const empty = { score: 0, network_score: 0, performance_score: 0, quality_score: 0, coverage: 0 };
  assert.equal(buildScoreHelpModel(empty).calculation.consistent, true);
  assert.match(renderScoreHelp(empty), /отсутствие оценённых данных/);
  assert.match(renderScoreHelp(empty), /качество IP не измерено/);
  const missing = buildScoreHelpModel({ score: 60, network_score: 60, quality_score: 60 });
  assert.equal(missing.categories[1].score, null);
  assert.equal(missing.calculation, null);
  for (const report of [{ ...row, score: 100 }, { score: 60 }]) {
    const html = renderScoreHelp(report);
    assert.match(html, /нельзя точно восстановить/);
    assert.doesNotMatch(html, /По сохранённым оценкам:/);
  }
});

test("numeric summary inputs are validated and report text cannot inject markup", () => {
  const attack = '<img src=x onerror="alert(1)">';
  for (const invalid of [null, undefined, "", " ", false, true, [], [70], {}, -1, 101, 25.5, "NaN", attack]) {
    const model = buildScoreHelpModel({ ...row, quality_score: invalid });
    assert.equal(model.categories[2].score, null, String(invalid));
    assert.equal(model.calculation, null);
  }
  assert.equal(buildScoreHelpModel({ ...row, score: "70" }).total, 70);
  assert.doesNotMatch(renderScoreHelp({ ...row, cpu: attack, quality_score: attack }), /onerror|<img/);
  assert.doesNotThrow(() => renderScoreHelp(null));
});

test("one native disclosure supports touch, keyboard, RU/EN and a narrow layout without overlays", () => {
  const html = renderScoreHelp(row);
  assert.equal((html.match(/<details\b/g) || []).length, 1);
  assert.equal((html.match(/<summary>/g) || []).length, 1);
  assert.match(html, /data-i18n-ru="Откуда берутся баллы" data-i18n-en="How scores are calculated"/);
  assert.match(html, /Что значит «Качество IP»/);
  assert.match(html, /резерв|запасное значение 60/);
  assert.doesNotMatch(html, /<script|onclick=|role="tooltip"|title=/);
  assert.match(scoreHelpStyles, /min-height:44px/);
  assert.match(scoreHelpStyles, /:focus-visible/);
  assert.match(scoreHelpStyles, /overflow-wrap:anywhere/);
  assert.match(scoreHelpStyles, /prefers-reduced-motion/);
  assert.doesNotMatch(scoreHelpStyles, /position:\s*(?:fixed|absolute)|min-width:\s*[1-9]\d{2}px/);
});

test("summary explanation stays compatible with the actual Worker scorer, including its 60 fallback", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("function numeric(");
  const end = source.indexOf("function item(", start);
  assert.ok(start >= 0 && end > start, "Worker scorer must be available for the compatibility test");
  const context = vm.createContext({
    splitRows: (value = "") => value ? String(value).split("\n").filter(Boolean).map((line) => line.split("\x1f")) : [],
    clamp: (value) => Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0)),
  });
  vm.runInContext(source.slice(start, end), context);
  const lines = (records) => records.map((record) => record.join("\x1f")).join("\n");
  const fixtures = [
    { statuses: [["run_ip_region", "Region", "выполнен"]], metrics: [], services: [] },
    { statuses: [["run_ip_quality", "Quality", "выполнен"], ["run_yabs", "YABS", "ошибка"]], metrics: [["run_ip_quality", "Риск", "Medium", "ok"]], services: [] },
    { statuses: [["run_ip_region", "Region", "выполнен"], ["run_sysbench_cpu", "CPU", "выполнен"], ["run_ip_quality", "Quality", "выполнен"]], metrics: [["run_ip_region", "Ping", "50 ms", "ok"], ["run_sysbench_cpu", "events/s", "1000", "ok"], ["run_ip_quality", "DNSBL", "0", "ok"]], services: [["run_ip_quality", "risk", "Database", "", "bad", "high"]] },
    { statuses: [], metrics: [], services: [] },
  ];
  for (const fixture of fixtures) {
    const result = context.calculateScores(lines(fixture.statuses), lines(fixture.metrics), lines(fixture.services));
    const report = { score: result.total, network_score: result.network, performance_score: result.performance, quality_score: result.quality, coverage: result.coverage };
    const model = buildScoreHelpModel(report);
    assert.equal(model.calculation.consistent, true, JSON.stringify(report));
    assert.equal(model.calculation.score, result.total);
  }
  const fallback = context.calculateScores(lines(fixtures[0].statuses), "", "");
  assert.equal(fallback.total, 60, "The displayed fallback explanation must reflect the actual current scorer");
  assert.equal(fallback.coverage, 9);
});
