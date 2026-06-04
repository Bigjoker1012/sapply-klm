/**
 * Регрессионные тесты на сопоставление синонимов с каталогом.
 *
 * Эти тесты защищают ХРУПКУЮ логику резолва синонимов от двух известных
 * регрессий:
 *   1) «нормализация подчёркивания» (RAW030 → RAW_030) — даёт уверенно-неверные
 *      привязки, потому что старая нумерация кодов НЕ соответствует текущему
 *      каталогу (RAW_030 — другая позиция).
 *   2) ложные fuzzy-привязки по общему слову («Сульфат марганца» →
 *      «Сульфат магния»).
 *
 * Запуск: `npm test`
 *
 * findRawByAlias/matchBatch ходят в Google Sheets через connectors-SDK. Чтобы
 * прогонять чистую логику без сети, подменяем '@replit/connectors-sdk' в
 * require-кэше ДО загрузки sheetsService и отдаём фиктивные строки листов.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// ─── Фикстуры листов ────────────────────────────────────────────────────────
// Каталог (Syryo): A=raw_uid, B=full_name, C=short_name, D=unit, E..H — прочее.
const SYRYO_ROWS: any[][] = [
  ["RAW_001", "Витамин A", "Вит A", "кг", "100", "0,5", "30", "TRUE"],
  ["RAW_011", "Сульфат магния", "Магний сульфат", "кг", "200", "0,5", "30", "TRUE"],
  ["RAW_020", "Кобальт углекислый", "Кобальт", "кг", "10", "0,5", "30", "TRUE"],
  ["RAW_030", "Биогром Холин", "Холин", "кг", "50", "0,5", "30", "TRUE"],
];

// Лист Aliases: смесь двух форматов строк.
//   OLD (ручной):  A=код,    B=текст_синонима, C=тип,   D=источник
//   NEW (авто):    A=AL_xxx, B=raw_uid,        C=текст, D=источник
const ALIASES_ROWS: any[][] = [
  // OLD, валидный код (точное совпадение с каталогом) → resolved.
  ["RAW_001", "Ретинол", "manual", "curated"],
  // OLD, старые коды НЕ из текущей схемы → resolved=false, привязки нет.
  ["RAW030", "Сульфат марганца", "manual", "curated"],
  ["RAW020", "Оксид магния", "manual", "curated"],
  // NEW (AL_), валидный raw_uid → resolved.
  ["AL_1700000000001", "RAW_011", "Магния сульфат технический", "auto"],
  // NEW (AL_), несуществующий raw_uid → resolved=false.
  ["AL_1700000000002", "RAW_999", "Неизвестное вещество", "auto"],
];

// ─── Мок сетевого слоя (connectors-SDK) ─────────────────────────────────────
class FakeReplitConnectors {
  async proxy(_connector: string, path: string, _opts: any) {
    const decoded = decodeURIComponent(path);
    let values: any[][] = [];
    if (decoded.includes("Syryo")) values = SYRYO_ROWS;
    else if (decoded.includes("Aliases")) values = ALIASES_ROWS;
    return { json: async () => ({ values }) };
  }
}

// Подмена модуля ДО загрузки sheetsService.
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) {
  if (request === "@replit/connectors-sdk") {
    return { ReplitConnectors: FakeReplitConnectors };
  }
  return origLoad.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const svc = require("./sheetsService") as typeof import("./sheetsService");
const { parseAliasRows, findRawByAlias, matchBatch, invalidateCache } = svc;

const MATERIALS = SYRYO_ROWS.map(r => ({ raw_uid: String(r[0]) }));

// ─── parseAliasRows ─────────────────────────────────────────────────────────

test("parseAliasRows: точное совпадение кода каталога → resolved", () => {
  const parsed = parseAliasRows([["RAW_001", "Ретинол", "manual", "curated"]], MATERIALS);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].resolved, true);
  assert.equal(parsed[0].canonical_raw_uid, "RAW_001");
  assert.equal(parsed[0].synonym, "Ретинол");
});

test("parseAliasRows: старые коды RAW030/RAW020 НЕ нормализуются → resolved=false", () => {
  const parsed = parseAliasRows(
    [
      ["RAW030", "Сульфат марганца", "manual", "curated"],
      ["RAW020", "Оксид магния", "manual", "curated"],
    ],
    MATERIALS,
  );
  assert.equal(parsed.length, 2);
  for (const p of parsed) {
    assert.equal(p.resolved, false, `${p.code} не должен резолвиться`);
    assert.equal(p.canonical_raw_uid, null, `${p.code} не должен получать canonical_raw_uid`);
  }
});

test("parseAliasRows: AL_-строки с валидным raw_uid → resolved, с невалидным → false", () => {
  const parsed = parseAliasRows(
    [
      ["AL_1700000000001", "RAW_011", "Магния сульфат технический", "auto"],
      ["AL_1700000000002", "RAW_999", "Неизвестное вещество", "auto"],
    ],
    MATERIALS,
  );
  const ok = parsed.find(p => p.synonym === "Магния сульфат технический")!;
  const bad = parsed.find(p => p.synonym === "Неизвестное вещество")!;
  assert.equal(ok.resolved, true);
  assert.equal(ok.canonical_raw_uid, "RAW_011");
  assert.equal(ok.id, "AL_1700000000001"); // col A сохраняется для DELETE-роута
  assert.equal(bad.resolved, false);
  assert.equal(bad.canonical_raw_uid, null);
});

// ─── findRawByAlias ─────────────────────────────────────────────────────────

test("findRawByAlias: прямое совпадение по имени каталога", async () => {
  invalidateCache();
  assert.equal(await findRawByAlias("Витамин A"), "RAW_001");
});

test("findRawByAlias: синоним из валидной строки Aliases резолвится", async () => {
  invalidateCache();
  assert.equal(await findRawByAlias("Магния сульфат технический"), "RAW_011");
});

test("findRawByAlias: синоним из неваллидного старого кода НЕ привязывается ложно", async () => {
  invalidateCache();
  // «Сульфат марганца» висит на RAW030 (resolved=false). Fuzzy не должен
  // привязать его к «Сульфат магния» (RAW_011) — лишь общий токен «сульфат».
  assert.equal(await findRawByAlias("Сульфат марганца"), null);
});

// ─── matchBatch ─────────────────────────────────────────────────────────────

test("matchBatch: разрешает точные/синонимные имена и не привязывает неоднозначные", async () => {
  invalidateCache();
  const res = await matchBatch([
    "Сульфат магния",            // прямое имя каталога → RAW_011
    "Магния сульфат технический", // валидный синоним → RAW_011
    "Сульфат марганца 32%",       // fuzzy-ловушка (магний vs марганец) → null
    "Оксид магния",               // висит на RAW020 (resolved=false) → null
  ]);
  assert.equal(res.get("Сульфат магния"), "RAW_011");
  assert.equal(res.get("Магния сульфат технический"), "RAW_011");
  assert.equal(res.get("Сульфат марганца 32%"), null);
  assert.equal(res.get("Оксид магния"), null);
});
