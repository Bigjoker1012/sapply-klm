/**
 * Разовый патч сопоставления сырья в существующих рецептах (Задача 1).
 *
 * Разбор рецепта НЕ перепрогоняется (recipe parse не live): добавление алиаса
 * чинит только БУДУЩИЕ загрузки. Чтобы исправить УЖЕ загруженные рецепты, правим
 * напрямую строки RecipeLines (col C raw_uid, col L match_status="matched") и
 * пересчитываем Need (deleteNeedByRecipe + writeNeedFromRecipe из matched-строк,
 * net_qty = consumption_kg — тот же расчёт, что transitionRecipe в recipes.ts).
 *
 * Алиасы добавляем тоже — чтобы новые загрузки этих позиций сопоставлялись сами.
 *
 * Запуск:
 *   DRY-RUN (только показать, ничего не писать):
 *     DRY_RUN=1 npx ts-node --transpile-only -P server/tsconfig.json server/src/scripts/fix-recipe-matches.ts
 *   ПРИМЕНИТЬ:
 *     npx ts-node --transpile-only -P server/tsconfig.json server/src/scripts/fix-recipe-matches.ts
 */
import {
  readRange, writeRange, getAllRawMaterials,
  addAliasesBatch, getRecipeLines, deleteNeedByRecipe, writeNeedFromRecipe,
} from "../services/sheetsService";

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

// Алиасы для будущих загрузок (синоним-текст → catalog raw_uid).
const ALIASES = [
  { raw_uid: "RAW_009", alias: "ВИТАМИН Н БИОТИН-2% фид грейд", source: "manual-fix" },
  { raw_uid: "RAW_035", alias: "БИОПРОМИС ХРОМ Пик-0,21%", source: "manual-fix" },
  { raw_uid: "RAW_035", alias: "БИОПРОМИС ХРОМ Пик-0,22%", source: "manual-fix" },
];

// Строки RecipeLines, которым нужно проставить raw_uid + match_status=matched.
const LINE_FIXES: { id: string; raw_uid: string; recipe_uid: string }[] = [
  { id: "RL_1781616713775_3",  raw_uid: "RAW_009", recipe_uid: "REC_1781616713512" }, // ПЛЦ-180 вит Н
  { id: "RL_1781616795961_14", raw_uid: "RAW_035", recipe_uid: "REC_1781616795715" }, // ПЛЦ-182 хром 0,21%
  { id: "RL_1781617025931_19", raw_uid: "RAW_035", recipe_uid: "REC_1781617025727" }, // ПЛЦ-35  хром 0,22%
  { id: "RL_1781617041695_4",  raw_uid: "RAW_009", recipe_uid: "REC_1781617041473" }, // ПЛЦ-186 вит Н
  { id: "RL_1781617041695_16", raw_uid: "RAW_035", recipe_uid: "REC_1781617041473" }, // ПЛЦ-186 хром 0,22%
  { id: "RL_1781617049340_4",  raw_uid: "RAW_009", recipe_uid: "REC_1781617049089" }, // ПЛЦ-187 вит Н
];

const RECIPES = Array.from(new Set(LINE_FIXES.map(l => l.recipe_uid)));

async function main() {
  console.log(`=== fix-recipe-matches (${DRY_RUN ? "DRY-RUN" : "APPLY"}) ===\n`);

  // 0) Проверяем, что целевые raw_uid существуют в каталоге.
  const catalog = await getAllRawMaterials();
  const byUid = new Map(catalog.map(m => [m.raw_uid, m]));
  for (const uid of new Set(LINE_FIXES.map(l => l.raw_uid))) {
    const m = byUid.get(uid);
    console.log(m ? `caталог OK ${uid} = ${m.full_name}` : `!!! НЕТ В КАТАЛОГЕ: ${uid}`);
    if (!m) throw new Error(`raw_uid ${uid} отсутствует в каталоге — патч отменён`);
  }
  console.log("");

  // 1) Патчим RecipeLines.
  const rows = await readRange("RecipeLines", "A2:L5000");
  const byId = new Map<string, number>(); // id → индекс в rows
  rows.forEach((r, i) => byId.set(String(r[0]), i));

  for (const fix of LINE_FIXES) {
    const idx = byId.get(fix.id);
    if (idx === undefined) {
      console.log(`!!! строка не найдена: ${fix.id}`);
      throw new Error(`RecipeLine ${fix.id} не найдена — патч отменён`);
    }
    const r = rows[idx];
    const sheetRow = idx + 2;
    console.log(
      `${fix.id} [row ${sheetRow}] "${r[3]}"  raw_uid: "${r[2] || ""}"→"${fix.raw_uid}"  ` +
      `match: "${r[11] || ""}"→"matched"  consumption_kg=${r[7]}`,
    );
    if (!DRY_RUN) {
      await writeRange("RecipeLines", `C${sheetRow}:C${sheetRow}`, [[fix.raw_uid]]);
      await writeRange("RecipeLines", `L${sheetRow}:L${sheetRow}`, [["matched"]]);
    }
  }
  console.log("");

  // 2) Алиасы (для будущих загрузок).
  console.log(`Алиасы (${ALIASES.length}):`);
  for (const a of ALIASES) console.log(`  ${a.alias} → ${a.raw_uid}`);
  if (!DRY_RUN) await addAliasesBatch(ALIASES);
  console.log("");

  // 3) Пересчёт Need для затронутых рецептов (тот же расчёт, что transitionRecipe).
  for (const uid of RECIPES) {
    const lines = await getRecipeLines(uid);
    const needLines = lines
      .filter(l => l.raw_uid && l.match_status === "matched" && l.consumption_kg > 0)
      .map(l => ({ raw_uid: l.raw_uid as string, net_qty: l.consumption_kg as number }));
    console.log(`${uid}: matched-строк с расходом = ${needLines.length}`);
    for (const n of needLines) console.log(`    ${n.raw_uid}  net_qty=${n.net_qty}`);
    if (!DRY_RUN) {
      const removed = await deleteNeedByRecipe(uid);
      if (needLines.length) await writeNeedFromRecipe(uid, needLines);
      console.log(`    → Need: удалено ${removed}, записано ${needLines.length}`);
    }
  }

  console.log(`\n=== ${DRY_RUN ? "DRY-RUN завершён (ничего не записано)" : "ПАТЧ ПРИМЕНЁН"} ===`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error("FATAL:", err); process.exit(1); });
