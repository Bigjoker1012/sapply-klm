import { readRange, writeRange, addAlias } from "./server/src/services/sheetsService";
(async () => {
  // 1) RecipeLines: строка RL_1781267671956_4 (ВИТАМИН В3 кальция пантот) C: RAW_001 -> RAW_006
  const rl = await readRange("RecipeLines", "A2:L5000");
  let rlRow = -1;
  for (let i = 0; i < rl.length; i++) if (String(rl[i][0]) === "RL_1781267671956_4") { rlRow = i; break; }
  if (rlRow < 0) { console.log("RecipeLines строка не найдена!"); }
  else {
    console.log(`RecipeLines до: C=${rl[rlRow][2]} имя=${rl[rlRow][3]}`);
    await writeRange("RecipeLines", `C${rlRow + 2}:C${rlRow + 2}`, [["RAW_006"]]);
    console.log(`RecipeLines после: C=RAW_006 (строка листа ${rlRow + 2})`);
  }
  // 2) Need: строка recipe=REC_1781267671721 & raw=RAW_001 -> RAW_006 (col C idx2)
  const need = await readRange("Need", "A2:H5000");
  let needRow = -1;
  for (let i = 0; i < need.length; i++)
    if (String(need[i][1]) === "REC_1781267671721" && String(need[i][2]) === "RAW_001") { needRow = i; break; }
  if (needRow < 0) console.log("Need строка (REC_1781267671721/RAW_001) не найдена (возможно нет — ок)");
  else {
    console.log(`Need до: C=${need[needRow][2]} net=${need[needRow][6]}`);
    await writeRange("Need", `C${needRow + 2}:C${needRow + 2}`, [["RAW_006"]]);
    console.log(`Need после: C=RAW_006 (строка листа ${needRow + 2})`);
  }
  // 3) Синоним, чтобы будущие загрузки матчили точно (а не fuzzy→RAW_001)
  await addAlias("RAW_006", "ВИТАМИН В3_кальция пантот 98%", "синоним");
  console.log("Синоним добавлен: 'ВИТАМИН В3_кальция пантот 98%' -> RAW_006");
})();
