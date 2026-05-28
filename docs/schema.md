# Supply KLM — схема данных (черновик v1)

Цель: уйти с Google Sheets как «базы», на нормализованную SQLite-БД через Drizzle ORM.
Все операции — атомарные транзакции, все изменения — в `event_log`, партии сырья
(`batch`) — основная единица учёта, остатки получаются агрегацией.

Стек: **SQLite + Drizzle ORM** (миграции, типобезопасные запросы), при росте можно мигрировать на Postgres без переписывания доменной логики.

---

## Глоссарий — английское имя ↔ русское

Эти английские имена видит только разработчик и БД. Пользователю в интерфейсе всегда показываются русские подписи из этой таблицы.

### Таблицы

| Английское     | Русское                                | Что хранит                                                |
|----------------|----------------------------------------|-----------------------------------------------------------|
| `organization` | Организация (юрлицо)                   | Полоцкий КХП, Гомельский КХП и т.д.                       |
| `warehouse`    | Склад                                  | Полоцк, Липковская…                                       |
| `supplier`     | Поставщик                              | Адиссео, БАСФ, Эвоник…                                    |
| `sku`          | Сырьё (позиция каталога)               | Лизин 98.5%, Метионин и т.д.                              |
| `sku_alias`    | Альтернативное название сырья          | как это сырьё называли в 1С / PDF / Excel                 |
| `batch`        | Партия сырья (LOT)                     | конкретная пришедшая партия с датой годности              |
| `stock_movement` | Движение по складу                   | приход / расход / переброска / списание                   |
| `stock_snapshot` | Снимок остатков                      | зафиксированные остатки на дату (для аудита)              |
| `recipe`       | Рецепт премикса                        | П-12, Р-СВ-15 и т.д., с версиями                          |
| `recipe_item`  | Состав рецепта (строка)                | какое сырьё и в какой дозировке                           |
| `production_plan` | План производства                   | что и когда смешиваем                                     |
| `in_transit`   | Поступление в пути                     | сырьё, которое едет к нам                                 |
| `transfer`     | Переброска между складами              | Полоцк ↔ Липковская                                       |
| `transfer_batch` | Партии в переброске                  | какие именно LOT-ы переброшены                            |
| `purchase_order` | Заказ поставщику                     | то, что родилось из кнопки «Заказать N кг»                |
| `upload_job`   | Загрузка файла                         | каждая загрузка Excel/PDF                                 |
| `upload_row`   | Строка загрузки                        | сырая строка из загруженного файла до маппинга            |
| `event_log`    | Журнал событий                         | аудит каждой правки                                       |
| `user`         | Пользователь                           |                                                           |
| `session`      | Сессия входа                           |                                                           |

### Часто встречающиеся колонки

| Английское          | Русское                                  |
|---------------------|------------------------------------------|
| `id`                | Идентификатор                            |
| `code`              | Код                                      |
| `name`              | Название                                 |
| `sku_id`            | Сырьё                                    |
| `warehouse_id`      | Склад                                    |
| `supplier_id`       | Поставщик                                |
| `qty_kg`            | Количество, кг                           |
| `qty_t`             | Количество, т                            |
| `initial_qty_kg`    | Пришло (исходное кол-во), кг             |
| `current_qty_kg`    | Текущий остаток, кг                      |
| `min_stock_kg`      | Страховой запас, кг                      |
| `reorder_point_kg`  | Точка перезаказа, кг                     |
| `dose_kg_per_t`     | Дозировка, кг на тонну премикса          |
| `lot_no`            | № партии                                 |
| `manufacture_date`  | Дата производства                        |
| `expiry_date`       | Срок годности до                         |
| `received_at`       | Принято на склад                         |
| `eta_date`          | Ожидаемая дата поступления (ETA)         |
| `planned_date`      | Плановая дата                            |
| `completed_at`      | Дата завершения                          |
| `unit_price`        | Цена за единицу                          |
| `currency`          | Валюта                                   |
| `status`            | Статус                                   |
| `kind`              | Тип / Вид                                |
| `transport`         | Способ доставки                          |
| `po_ref`            | Номер договора / заказа                  |
| `certificate_no`    | № сертификата качества                   |
| `confidence`        | Уверенность распознавания (0..1)         |
| `created_at`        | Создано                                  |
| `created_by`        | Создал (пользователь)                    |
| `uploaded_at`       | Загружено                                |
| `uploaded_by`       | Загрузил (пользователь)                  |
| `actor_id`          | Кто сделал                               |
| `comment`           | Комментарий                              |
| `active`            | Активно (да/нет)                         |

В коде Drizzle каждая таблица и каждая колонка получит русский комментарий — при наведении мышкой в редакторе сразу видно расшифровку. Пример:

```ts
// Партия сырья (LOT). Атомарная единица складского учёта.
export const batch = sqliteTable("batch", {
  id: integer("id").primaryKey(),
  /** Сырьё */            skuId: integer("sku_id").references(() => sku.id),
  /** Склад */            warehouseId: integer("warehouse_id").references(() => warehouse.id),
  /** № партии */         lotNo: text("lot_no"),
  /** Срок годности до */ expiryDate: text("expiry_date"),
  /** Пришло, кг */       initialQtyKg: real("initial_qty_kg"),
  /** Текущий остаток, кг */ currentQtyKg: real("current_qty_kg"),
  // …и т.д.
});
```

---

## 1. Справочники

### `warehouse` — склады
| поле          | тип           | примечание                          |
|---------------|---------------|-------------------------------------|
| id            | int PK        | 1 = Полоцк, 2 = Липковская          |
| code          | text UNIQUE   | `POLOTSK`, `LIPKOV`                 |
| name          | text          | «Полоцкий КХП», «Липковская»        |
| is_main       | bool          | true для Полоцка (основное произв.) |
| active        | bool          |                                     |

### `supplier` — поставщики
| поле        | тип        | примечание                              |
|-------------|------------|-----------------------------------------|
| id          | int PK     |                                         |
| name        | text       | «Адиссео», «БАСФ»…                      |
| country     | text       |                                         |
| inn         | text       |                                         |
| contact     | text       | контактные данные одной строкой         |
| active      | bool       |                                         |

### `sku` — справочник сырья (мастер-каталог)
| поле               | тип            | примечание                                       |
|--------------------|----------------|--------------------------------------------------|
| id                 | int PK         |                                                  |
| code               | text UNIQUE    | внутренний код, напр. `AA-LYS-985`               |
| name               | text           | «Лизин монохлоргидрат 98.5%»                     |
| category           | text           | enum: аминокислоты / витамины / микроэлементы / наполнители / антиоксиданты / прочее |
| unit               | text           | по умолч. `кг`                                   |
| default_supplier_id| int FK→supplier| предпочтительный поставщик (не обязательный)     |
| shelf_life_days    | int            | срок годности по умолчанию                       |
| min_stock_kg       | numeric        | страховой запас (для расчёта статуса «Срочно»)   |
| reorder_point_kg   | numeric        | точка перезаказа                                 |
| active             | bool           |                                                  |

### `sku_alias` — синонимы названий для матчинга OCR/Excel
| поле       | тип              | примечание                                        |
|------------|------------------|---------------------------------------------------|
| id         | int PK           |                                                   |
| sku_id     | int FK→sku       |                                                   |
| alias      | text             | вариант написания из 1С / Excel / PDF             |
| source     | text             | `1c`, `pdf_recipe`, `manual`                      |

Уникальный индекс `(lower(alias))` — для быстрого fuzzy-матча.

---

## 2. Складской учёт (immutable batch model)

### `batch` — партия сырья (lot)
Партия — атомарная единица. **Никогда не меняется в количестве напрямую**;
изменения проходят через `stock_movement`.

| поле              | тип             | примечание                                   |
|-------------------|-----------------|----------------------------------------------|
| id                | int PK          |                                              |
| sku_id            | int FK→sku      |                                              |
| warehouse_id      | int FK→warehouse|                                              |
| lot_no            | text            | номер партии от поставщика                   |
| supplier_id       | int FK→supplier | nullable (для исторических остатков)         |
| manufacture_date  | date            |                                              |
| expiry_date       | date            |                                              |
| initial_qty_kg    | numeric         | сколько пришло                               |
| current_qty_kg    | numeric         | derived (сумма movements), денормализовано   |
| unit_price        | numeric         | цена за кг                                   |
| currency          | text            | `BYN`, `RUB`, `USD`, `EUR`                   |
| certificate_no    | text            | номер сертификата качества                   |
| received_at       | timestamp       |                                              |
| status            | text            | `active` / `quarantine` / `written_off`      |

Уникальный индекс `(sku_id, lot_no, warehouse_id)`.

### `stock_movement` — все движения партии
| поле          | тип              | примечание                                          |
|---------------|------------------|-----------------------------------------------------|
| id            | int PK           |                                                     |
| batch_id      | int FK→batch     |                                                     |
| kind          | text             | `receipt` / `consumption` / `transfer_out` / `transfer_in` / `writeoff` / `correction` |
| qty_kg        | numeric          | положительное число; знак выводится из `kind`       |
| ref_type      | text             | `production_plan` / `transfer` / `upload_job` / `manual` |
| ref_id        | int              | id связанной сущности                                |
| occurred_at   | timestamp        |                                                     |
| actor_id      | int FK→user      |                                                     |
| comment       | text             |                                                     |

Остаток партии = `initial_qty_kg` − Σ(movements). `current_qty_kg` пересчитывается триггером/job-ом для скорости.

**Текущий остаток по SKU/складу** (для главной таблицы дашборда) — это view:
```sql
SELECT sku_id, warehouse_id, SUM(current_qty_kg) AS qty_kg
FROM batch
WHERE status = 'active' AND current_qty_kg > 0
GROUP BY sku_id, warehouse_id;
```

### `stock_snapshot` — фиксированный снимок остатков на дату
Нужен для аудита («что было в КД на 25.05») и для отката, если загрузка сломала остатки.
| поле          | тип             | примечание                          |
|---------------|-----------------|-------------------------------------|
| id            | int PK          |                                     |
| warehouse_id  | int FK          |                                     |
| snapshot_date | date            |                                     |
| source        | text            | `upload_job:42`, `manual`           |
| payload_json  | json            | сырой остаток `[{sku_id, qty_kg}…]` |
| created_at    | timestamp       |                                     |

---

## 3. Рецепты и план производства

### `recipe` — рецепт премикса
| поле          | тип        | примечание                              |
|---------------|------------|-----------------------------------------|
| id            | int PK     |                                         |
| code          | text       | «П-12», «Р-СВ-15» (внутр. шифр)         |
| name          | text       | «Премикс свиньи откорм 1%»              |
| target_animal | text       | `свиньи` / `птица` / `КРС` / `прочее`   |
| version       | int        | инкремент при изменении состава         |
| active_from   | date       |                                         |
| active_to     | date       | nullable                                |
| status        | text       | `draft` / `active` / `archived`         |
| source_pdf_id | int FK→upload_job | если рецепт пришёл из PDF        |
| created_by    | int FK→user|                                         |
| created_at    | timestamp  |                                         |

Уникально `(code, version)`.

### `recipe_item` — состав рецепта
| поле          | тип             | примечание                                  |
|---------------|-----------------|---------------------------------------------|
| id            | int PK          |                                             |
| recipe_id     | int FK→recipe   |                                             |
| sku_id        | int FK→sku      |                                             |
| dose_kg_per_t | numeric         | дозировка на тонну премикса                 |
| sort_order    | int             | порядок в таблице рецепта                   |
| note          | text            |                                             |

Уникально `(recipe_id, sku_id)`.

### `production_plan` — план смешивания премиксов
| поле          | тип               | примечание                                   |
|---------------|-------------------|----------------------------------------------|
| id            | int PK            |                                              |
| recipe_id     | int FK→recipe     |                                              |
| qty_t         | numeric           | тонн премикса                                |
| planned_date  | date              | плановая дата смешивания                     |
| warehouse_id  | int FK→warehouse  | где производим                               |
| status        | text              | `planned` / `in_progress` / `done` / `cancelled` |
| actual_qty_t  | numeric           | сколько реально произвели                    |
| done_at       | timestamp         |                                              |

---

## 4. Снабжение

### `in_transit` — поступления в пути
| поле          | тип             | примечание                                   |
|---------------|-----------------|----------------------------------------------|
| id            | int PK          |                                              |
| sku_id        | int FK→sku      |                                              |
| supplier_id   | int FK→supplier |                                              |
| warehouse_id  | int FK→warehouse| куда придёт                                  |
| qty_kg        | numeric         |                                              |
| unit_price    | numeric         |                                              |
| currency      | text            |                                              |
| eta_date      | date            |                                              |
| transport     | text            | `truck` / `rail` / `sea` / `air`             |
| status        | text            | `at_supplier` / `in_transit` / `customs` / `received` |
| po_ref        | text            | номер договора / заказа                      |
| received_batch_id | int FK→batch| заполняется при `status='received'`          |
| created_at    | timestamp       |                                              |

При `status='received'` — создаётся `batch` и `stock_movement(kind='receipt')`.

### `transfer` — переброски между складами
| поле               | тип             | примечание                                      |
|--------------------|-----------------|-------------------------------------------------|
| id                 | int PK          |                                                 |
| sku_id             | int FK→sku      |                                                 |
| from_warehouse_id  | int FK          |                                                 |
| to_warehouse_id    | int FK          |                                                 |
| qty_kg             | numeric         |                                                 |
| status             | text            | `planned` / `in_transit` / `received` / `cancelled` |
| planned_date       | date            |                                                 |
| completed_at       | timestamp       |                                                 |
| created_by         | int FK→user     |                                                 |
| comment            | text            |                                                 |

### `transfer_batch` — какие партии конкретно переброшены (M:N)
| поле          | тип               |
|---------------|-------------------|
| transfer_id   | int FK→transfer   |
| batch_id      | int FK→batch      |
| qty_kg        | numeric           |

PK = (transfer_id, batch_id).

### `purchase_order` — заказ поставщику (next step из «Заказать N кг»)
| поле          | тип             | примечание                              |
|---------------|-----------------|-----------------------------------------|
| id            | int PK          |                                         |
| sku_id        | int FK→sku      |                                         |
| supplier_id   | int FK→supplier |                                         |
| qty_kg        | numeric         |                                         |
| unit_price    | numeric         |                                         |
| currency      | text            |                                         |
| status        | text            | `draft` / `sent` / `confirmed` / `cancelled` / `fulfilled` |
| expected_eta  | date            |                                         |
| in_transit_id | int FK→in_transit | заполняется когда PO «выехала»         |
| created_by    | int FK→user     |                                         |
| created_at    | timestamp       |                                         |

---

## 5. Загрузки и аудит

### `upload_job` — каждая загрузка Excel/PDF
| поле          | тип       | примечание                                       |
|---------------|-----------|--------------------------------------------------|
| id            | int PK    |                                                  |
| kind          | text      | `stock_polotsk_xlsx` / `stock_lipkovskaya_xlsx` / `recipe_pdf` / `in_transit_xlsx` |
| filename      | text      |                                                  |
| file_hash     | text      | SHA-256, защита от повторной загрузки            |
| uploaded_by   | int FK→user|                                                 |
| uploaded_at   | timestamp |                                                  |
| status        | text      | `parsing` / `review` / `applied` / `rejected` / `failed` |
| rows_total    | int       |                                                  |
| rows_matched  | int       |                                                  |
| rows_unmatched| int       |                                                  |
| applied_at    | timestamp |                                                  |
| error         | text      |                                                  |

### `upload_row` — сырые строки до маппинга
| поле           | тип       | примечание                                     |
|----------------|-----------|------------------------------------------------|
| id             | int PK    |                                                |
| upload_job_id  | int FK    |                                                |
| row_index      | int       |                                                |
| sheet_name     | text      | для многолистовых Excel                        |
| raw_payload    | json      | вся исходная строка целиком                    |
| matched_sku_id | int FK→sku| nullable                                       |
| confidence     | numeric   | 0..1, оценка матчера                           |
| action         | text      | `auto_apply` / `manual_review` / `skip` / `rejected` |
| reviewed_by    | int FK→user|                                               |
| reviewed_at    | timestamp |                                                |
| review_note    | text      |                                                |

### `event_log` — аудит всего
| поле          | тип       | примечание                                  |
|---------------|-----------|---------------------------------------------|
| id            | int PK    |                                             |
| actor_id      | int FK→user|                                            |
| action        | text      | `recipe.create`, `batch.writeoff`, `po.send`… |
| entity_type   | text      |                                             |
| entity_id     | int       |                                             |
| before_json   | json      |                                             |
| after_json    | json      |                                             |
| ip            | text      |                                             |
| occurred_at   | timestamp |                                             |

---

## 6. Пользователи

### `user`
| поле           | тип       | примечание                                  |
|----------------|-----------|---------------------------------------------|
| id             | int PK    |                                             |
| login          | text UNIQUE| email или короткий логин                   |
| password_hash  | text      | argon2id                                    |
| name           | text      | «Иванов А.С.»                               |
| role           | text      | `admin` / `snabzhenets` / `tehnolog` / `viewer` |
| active         | bool      |                                             |
| last_login_at  | timestamp |                                             |

### `session`
| поле          | тип       |
|---------------|-----------|
| id            | text PK   | session token (random 32 байта)           |
| user_id       | int FK    |                                             |
| created_at    | timestamp |                                             |
| expires_at    | timestamp |                                             |
| ip            | text      |                                             |

---

## 7. Производные / расчёт «потребности»

Не таблица, а **материализованное представление**, пересчитывается раз в N минут
или при изменении плана/рецепта:

```sql
demand_per_sku(period_from, period_to) AS
  SELECT
    ri.sku_id,
    pp.warehouse_id,
    SUM(pp.qty_t * ri.dose_kg_per_t) AS demand_kg
  FROM production_plan pp
  JOIN recipe_item ri ON ri.recipe_id = pp.recipe_id
  WHERE pp.planned_date BETWEEN :from AND :to
    AND pp.status IN ('planned','in_progress')
  GROUP BY ri.sku_id, pp.warehouse_id;
```

«Статус» строки дашборда (Срочно / К закупке / Переброска / На контроле / Норма) — чистая функция от:
- текущего остатка (`batch` агрегат),
- остатка на парном складе,
- `in_transit.qty_kg` по этому SKU,
- `demand_kg` за выбранный горизонт,
- `sku.min_stock_kg`, `sku.reorder_point_kg`.

Не храним в БД — считаем на лету в сервисном слое, кэш в Redis/in-memory.

---

## Связи (cardinality)

```
sku 1—N batch          sku 1—N sku_alias       sku 1—N recipe_item
sku 1—N in_transit     sku 1—N transfer        sku 1—N purchase_order

warehouse 1—N batch    warehouse 1—N production_plan
warehouse 1—N transfer (from/to)

batch 1—N stock_movement       batch N—M transfer (via transfer_batch)
recipe 1—N recipe_item         recipe 1—N production_plan
supplier 1—N batch             supplier 1—N in_transit       supplier 1—N purchase_order
upload_job 1—N upload_row      upload_job 1—N recipe (для PDF)
user 1—N event_log             user 1—N session
```

---

## Что меняется по сравнению со «Sheets как БД»

| Сейчас (Sheets)                              | Станет (SQLite)                                       |
|----------------------------------------------|-------------------------------------------------------|
| Остатки = строки в листе, перезаписываются   | Партии (`batch`) + движения (`stock_movement`), история сохраняется |
| Рецепт — лист с дозировками                  | `recipe` (версионированный) + `recipe_item`           |
| «В пути» — строки в листе                    | `in_transit` со статусами и FK на supplier/sku        |
| Переброска — вручную в комментариях          | `transfer` + `transfer_batch`, атомарно меняет остатки|
| OCR/Excel-загрузки — пишут сразу в лист      | `upload_job` → review-экран → атомарный apply         |
| Аудита нет                                   | `event_log` по каждому изменению                      |
| Авторизации нет                              | `user` + `session`, роли                              |

---

## Принятые решения (зафиксировано)

1. **Версии рецептов** — храним полные копии `recipe_item` на каждую версию.
2. **Курсы валют (`fx_rate`)** — НЕ вводим. Цены храним в исходной валюте (`unit_price` + `currency`), пересчёт делается только при необходимости в отчётах руками/конфигом.
3. **Многозаводская модель** — да, проектируем сразу под N площадок. `warehouse` — единственная точка расширения, доменная логика не зависит от количества складов. Добавится `organization` / `legal_entity`, если разные заводы будут принадлежать разным юрлицам:

   ### `organization` (юрлицо/завод верхнего уровня)
   | поле     | тип     | примечание                              |
   |----------|---------|-----------------------------------------|
   | id       | int PK  |                                         |
   | code     | text    | `KHP_POLOTSK`, `KHP_GOMEL`              |
   | name     | text    | «Полоцкий КХП», «Гомельский КХП»        |
   | inn      | text    |                                         |
   | active   | bool    |                                         |

   `warehouse` получает FK `organization_id`. `user.role` дополняется FK `organization_id` (видит только свой завод; admin — все).

4. **Партии (`batch`)** — заводим сразу, агрегированный остаток не делаем.
5. **Дозировка рецепта** — `dose_kg_per_t` (кг на тонну премикса). Поле `dose_pct` не вводим, при загрузке PDF проценты конвертируются в кг/т.
