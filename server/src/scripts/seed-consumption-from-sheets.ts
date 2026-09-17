import { getAllRawMaterials } from "../services/sheetsService";
import { db, pool } from "../db/client";

/**
 * Скрипт: перенос avg_monthly_usage из Google Sheets в recipe_consumption.
 *
 * Логика: авто-расчёт = SUM(consumption_kg) за 3 месяца / 3.
 * Чтобы получить тот же avg_monthly_usage, создаём 3 записи (по одной
 * на каждый месяц) с consumption_kg = avg_monthly_usage.
 * Тогда SUM = avg_monthly_usage × 3, и auto_avg = SUM / 3 = avg_monthly_usage.
 *
 * Записи датируются 3 месяца назад (первый), 2 месяца назад, 1 месяц назад.
 */

async function main() {
  const materials = await getAllRawMaterials();
  const withAvg = materials.filter(m => m.avg_monthly_usage > 0);

  console.log(`Found ${withAvg.length} materials with avg_monthly_usage > 0`);

  // Удаляем старые фиктивные записи (если запускаем повторно)
  const delResult = await pool.query("DELETE FROM recipe_consumption WHERE recipe_uid LIKE 'SEED_%'");
  console.log("Deleted old seed records:", delResult.rowCount);

  const now = new Date();
  const inserted: { raw_uid: string; name: string; avg: number }[] = [];

  for (const m of withAvg) {
    const avg = m.avg_monthly_usage;
    if (!avg || avg <= 0) continue;

    // 3 записи: месяц -2, -1, 0 (все внутри 3-месячного окна)
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
      const dateStr = d.toISOString().split("T")[0];
      const recipeUid = `SEED_${dateStr}`;

      await pool.query(
        "INSERT INTO recipe_consumption (recipe_uid, raw_uid, consumption_kg, completed_at, created_at) VALUES ($1, $2, $3, $4, $5)",
        [recipeUid, m.raw_uid, avg, dateStr, dateStr]
      );
    }

    inserted.push({ raw_uid: m.raw_uid, name: m.short_name || m.full_name, avg });
  }

  console.log(`Inserted ${inserted.length * 3} records for ${inserted.length} materials`);
  console.log("Sample:", inserted.slice(0, 5));

  // Проверим авто-расчёт
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoff = threeMonthsAgo.toISOString().split("T")[0];

  const check = await pool.query(
    "SELECT raw_uid, SUM(consumption_kg) AS total, COUNT(*) AS cnt FROM recipe_consumption WHERE completed_at >= $1 GROUP BY raw_uid LIMIT 5",
    [cutoff]
  );
  console.log("\nVerification (auto_avg = total / 3):");
  for (const r of check.rows as any[]) {
    const autoAvg = Number(r.total) / 3;
    console.log(`  ${r.raw_uid}: total=${r.total}, cnt=${r.cnt}, auto_avg=${autoAvg.toFixed(2)}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
