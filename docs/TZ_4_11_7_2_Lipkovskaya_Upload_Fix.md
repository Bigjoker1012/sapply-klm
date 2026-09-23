# ТЗ 4.11.7.2 — ОТЧЁТ: Исправление загрузки КД Липковской

**Дата:** 2026-09-21
**Статус:** ВЫПОЛНЕНО

---

## 1. Изменённый файл

| Файл | Изменение |
|------|----------|
| `server/src/services/postgresSupplyService.ts` | Импорт `inArray` + замена `ANY()` на `inArray()` в `pgFilterKdSimilar()` |

---

## 2. Что изменено

### Было:
```typescript
import { sql } from "drizzle-orm";

const skuIds = payload.map((p: any) => p.sku_id);
const skuNames = await db.execute(sql`SELECT id, name FROM sku WHERE id = ANY(${skuIds})`);
for (const r of skuNames.rows as any[]) refTexts.push(String(r.name || ""));
```

### Стало:
```typescript
import { sql, inArray } from "drizzle-orm";

const skuIds = payload.map((p: any) => p.sku_id);
const skuTable = require("../db/schema").sku;
const skuNames = await db.select({ id: skuTable.id, name: skuTable.name }).from(skuTable).where(inArray(skuTable.id, skuIds));
for (const r of skuNames as any[]) refTexts.push(String(r.name || ""));
```

---

## 3. Результат build

```
> supply-klm@1.0.0 build:server
> tsc -p server/tsconfig.json

✅ 0 errors
```

---

## 4. Результат загрузки Липковской

| Параметр | Значение |
|----------|----------|
| HTTP код | ✅ 200 |
| Всего строк | 65 |
| Распознано | 28 |
| Отсеяно не-сырья | 37 |
| Партий записано | 28 |
| Общий вес | 67,863.6 кг |

---

## 5. Данные в БД

| Таблица | Записей | Сумма |
|---------|--------|-------|
| lip_batch (сегодня) | 28 | 67,863.6 кг |

---

## 6. Проверка Полоцка

```
GET /api/health → 200 OK
```

Приложение работает стабильно после перезапуска.

---

## 7. Git

- **Ветка:** fix/supply-audit-2026-09-17
- **Изменения:** postgresSupplyService.ts (импорт + pgFilterKdSimilar)
- **Статус:** Готово к коммиту
