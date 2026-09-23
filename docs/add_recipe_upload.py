import sys

# Read the file
with open('/opt/sapply-klm/server/src/routes/upload.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the export default router line
export_line = "export default router;"

# Create the recipe upload endpoint
recipe_endpoint = """
// --- Загрузка рецепта (PDF или Excel) ---

router.post("/recipe", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const up = readUpload(req);
    const isPdf = up.mimetype === "application/pdf" || up.originalname.endsWith(".pdf");
    const parsed = isPdf
      ? await parseRecipePdf(up.buffer)
      : parseRecipeExcel(up.buffer);

    // Parse batchTons from request
    const batchTons = parseFloat(String(req.body?.batchTons ?? "").replace(",", "."));
    const batch_t = Number.isFinite(batchTons) && batchTons > 0 ? batchTons : (parsed.batchKg ? parsed.batchKg / 1000 : 1);
    const base_batch_kg = batch_t * 1000;

    // Match raw materials
    const matchMap = await matchBatch(parsed.rows.map(r => r.rawName));

    const lines: { raw_uid: string; name_from_recipe: string; input_pct: number; norm_g_per_t: number; consumption_kg: number; match_status: string; }[] = [];
    const needLines: { raw_uid: string; net_qty: number }[] = [];
    let matched = 0;
    let unmatched = 0;
    let plant = 0;

    for (const row of parsed.rows) {
      const rawUid = matchMap.get(row.rawName);
      const dose_kg_per_t = row.percentage > 0
        ? (row.percentage / 100) * 1000
        : row.quantityPerTon > 0
        ? row.quantityPerTon / (parsed.batchKg ? parsed.batchKg / 1000 : 1)
        : 0;
      const consumption_kg = row.consumptionKg && row.consumptionKg > 0
        ? row.consumptionKg * (batch_t / (parsed.batchKg ? parsed.batchKg / 1000 : 1))
        : dose_kg_per_t * batch_t;

      lines.push({
        raw_uid: rawUid || "",
        name_from_recipe: row.rawName,
        input_pct: row.percentage,
        norm_g_per_t: Math.round(dose_kg_per_t * 1000),
        consumption_kg,
        match_status: rawUid ? "matched" : "unmatched",
      });

      if (rawUid) {
        if (consumption_kg > 0) {
          needLines.push({ raw_uid: rawUid, net_qty: consumption_kg });
        }
        matched++;
      } else {
        unmatched++;
      }
    }

    // Create recipe in database
    const recipeCode = parsed.code || recipeCodeFromFilename(up.originalname);
    const recipeName = parsed.name && parsed.name !== "Рецепт" && !isOrgName(parsed.name) && !isApprovalText(parsed.name)
      ? parsed.name
      : (recipeCode ? recipeFullName(recipeCode) : "Рецепт");

    const recipeUid = await writeRecipePG({
      code: recipeCode,
      full_name: recipeName,
      premix_name: recipeName,
      date: parsed.date,
      batch_t,
      customer: "",
      file_name: up.originalname,
      base_batch_kg,
      lines,
    });

    res.json({ ok: true, recipeUid, recipeName, total: parsed.rows.length, matched, unmatched, plant, batch_t });

    // Archive document after response
    saveDocument("recipe", { originalname: up.originalname, mimetype: up.mimetype, buffer: up.buffer }, recipeUid).catch(err => {
      console.error("[upload/recipe] saveDocument failed:", err?.message);
    });
  } catch (err: any) {
    console.error("[upload/recipe] error:", err?.stack || err);
    res.status(500).json({ error: err?.message || "Ошибка загрузки рецепта" });
  }
});

"""

# Insert the endpoint before the export
content = content.replace(export_line, recipe_endpoint + export_line)

# Write back
with open('/opt/sapply-klm/server/src/routes/upload.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Added recipe upload endpoint')
