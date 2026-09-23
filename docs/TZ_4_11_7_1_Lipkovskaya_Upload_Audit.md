# ТЗ 4.11.7.1 — ОТЧЁТ: Диагностика ошибки загрузки остатков Липковской

**Дата:** 2026-09-21
**Статус:** ДИАГНОСТИКА ЗАВЕРШЕНА

---

## 1. Воспроизводимость ошибки

**Эндпоинт:** `POST /api/upload/lipkovskaya-kd`
**Файл:** «Остатки Липковская 07.09 разверт.xlsx»
**Ошибка:** `malformed array literal: "66"`
**HTTP код:** 500

---

## 2. ROOT CAUSE

### 2.1 Проблемное место

**Файл:** `server/src/services/postgresSupplyService.ts`
**Функция:** `pgFilterKdSimilar()`
**Строка:** ~680-690

```typescript
const skuIds = payload.map((p: any) => p.sku_id);
const skuNames = await db.execute(sql`SELECT id, name FROM sku WHERE id = ANY(${skuIds})`);
```

### 2.2 Что происходит

1. Функция `pgFilterKdSimilar()` вызывается при загрузке КД Липковской
2. Она читает `payload_json` из таблицы `stock_snapshot` (warehouse_id = 1, Полоцк)
3. `payload_json` содержит: `[{"qty_kg": 1281.51, "sku_id": 66}]`
4. Код извлекает `skuIds = [66]` (JavaScript массив)
5. Передаёт в SQL: `WHERE id = ANY(${skuIds})`
6. Drizzle ORM некорректно сериализует массив `[66]` → PostgreSQL получает строку `"66"` вместо массива `'{66}'`
7. PostgreSQL выбрасывает: `malformed array literal: "66"`

### 2.3 Почему это происходит

Drizzle ORM в template literal `` sql`...` `` не всегда корректно обрабатывает JavaScript массивы. Когда массив передаётся через `${skuIds}`, Drizzle может сериализовать его как строку `"66"` вместо PostgreSQL массива `'{66}'`.

---

## 3. Проблемное поле

| Параметр | Значение |
|----------|----------|
| Поле | `payload_json` (таблица `stock_snapshot`) |
| Тип PostgreSQL | `jsonb` |
| Значение | `[{"qty_kg": 1281.51, "sku_id": 66}]` |
| Проблемный вызов | `id = ANY(${skuIds})` |

---

## 4. Фактическое значение из XLSX

Значение `66` — это `sku_id` из JSON payload, соответствующий позиции сырья в каталоге SKU. Это НЕ значение из XLSX файла, а уже сохранённое в базе данных.

---

## 5. Причина несовпадения типов

| Что ожидает PostgreSQL | Что получает |
|------------------------|--------------|
| `ANY(ARRAY[66])` или `ANY('{66}')` | `ANY('66')` (строка) |

Drizzle сериализует `[66]` как `"66"` вместо `'{66}'`.

---

## 6. Рекомендуемый минимальный FIX

### Вариант A: Использовать `= ANY(...)` с правильной сериализацией

```typescript
// Было:
const skuNames = await db.execute(sql`SELECT id, name FROM sku WHERE id = ANY(${skuIds})`);

// Стало:
const skuIdsPg = `{${skuIds.join(',')}}`;
const skuNames = await db.execute(sql`SELECT id, name FROM sku WHERE id = ANY(${skuIdsPg}::int[])`);
```

### Вариант B: Использовать `IN (...)` вместо `ANY`

```typescript
// Было:
const skuNames = await db.execute(sql`SELECT id, name FROM sku WHERE id = ANY(${skuIds})`);

// Стало:
if (skuIds.length > 0) {
  const placeholders = skuIds.map((_, i) => `$${i + 1}`).join(',');
  const skuNames = await db.execute({
    text: `SELECT id, name FROM sku WHERE id IN (${placeholders})`,
    values: skuIds
  });
}
```

### Вариант C: Использовать Drizzle `inArray` (рекомендуется)

```typescript
import { inArray } from 'drizzle-orm';

// Было:
const skuNames = await db.execute(sql`SELECT id, name FROM sku WHERE id = ANY(${skuIds})`);

// Стало:
const skuNames = await db.select({ id: sku.id, name: sku.name })
  .from(sku)
  .where(inArray(sku.id, skuIds));
```

---

## 7. Список файлов для изменения

| Файл | Изменение |
|------|----------|
| `server/src/services/postgresSupplyService.ts` | Исправить `pgFilterKdSimilar()` — заменить `ANY(${skuIds})` на корректную сериализацию |

---

## 8. Риски

| Риск | Оценка |
|------|--------|
| Влияние на загрузку Полоцка | ✅ Нет — Полоцк не использует `filterKdSimilar` |
| Влияние на загрузку рецептов | ✅ Нет — рецепты не используют `filterKdSimilar` |
| Влияние на другие загрузки КД | ⚠️ Да — все загрузки КД Липковской падают с этой ошибкой |
| Потеря данных | ✅ Нет — ошибка происходит ДО записи в БД |

---

## 9. GET /api/expiry → 404

**Причина:** Endpoint `/api/expiry` зарегистрирован в `server/src/routes/expiry.ts`, но:
1. Роут не подключён в `server/src/index.ts`
2. В index.ts нет строки `app.use("/api/expiry", expiryRoutes)`

**Назначение:** Отображение сроков годности партий Липковской с цветовой маркировкой (светофор).

**Исправление:** Добавить импорт и регистрацию роута в `index.ts`. НЕ входит в данное ТЗ.

---

## 10. Итог

| Параметр | Значение |
|----------|----------|
| ROOT CAUSE | Некорректная сериализация массива в Drizzle template literal |
| Проблемное поле | `skuIds` (массив чисел) |
| Тип PostgreSQL | `int[]` (ожидается), `text` (получается) |
| Файлов для изменения | 1 (`postgresSupplyService.ts`) |
| Риски | Минимальные — затронута только загрузка КД Липковской |
