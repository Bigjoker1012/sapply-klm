-- ============================================================================
-- 0001_triggers.sql — инварианты учёта на уровне БД
--
-- Drizzle-kit генерирует только структуру таблиц. Триггеры и сложные правила
-- держим отдельной "custom"-миграцией, потому что они не выводятся из схемы.
--
-- Что обеспечиваем:
--   1) batch.current_qty_kg = batch.initial_qty_kg − SUM(stock_movement.qty)
--      по списывающим типам движений. Поддерживается триггером AFTER INSERT.
--   2) stock_movement иммутабельно (нельзя UPDATE/DELETE).
--   3) transfer_batch.batch_sku_id и batch_warehouse_id обязаны совпадать
--      с transfer.sku_id и transfer.from_warehouse_id.
--
-- Соглашения по типам движений:
--   • receipt, transfer_in    — «созидательные», current ставится при INSERT
--     батча. Триггер их игнорирует (они только для аудита).
--   • consumption, transfer_out, writeoff, correction
--                              — «списывающие», триггер уменьшает current.
--   • Если нужно «инвентаризация нашла больше» — создаётся НОВЫЙ batch
--     (lot_no=ADJ-YYYY-MM-DD) с kind='receipt'. Так история чистая.
-- ============================================================================

-- 1) Поддержание batch.current_qty_kg при списывающих движениях ---------------
CREATE TRIGGER stock_movement_after_insert
AFTER INSERT ON stock_movement
WHEN NEW.kind IN ('consumption','transfer_out','writeoff','correction')
BEGIN
    UPDATE batch
       SET current_qty_kg = current_qty_kg - NEW.qty_kg
     WHERE id = NEW.batch_id;
END;
--> statement-breakpoint

-- 2) Иммутабельность stock_movement: UPDATE запрещён -------------------------
CREATE TRIGGER stock_movement_no_update
BEFORE UPDATE ON stock_movement
BEGIN
    SELECT RAISE(ABORT, 'stock_movement is immutable — create a compensating movement instead');
END;
--> statement-breakpoint

-- 3) Иммутабельность stock_movement: DELETE запрещён -------------------------
CREATE TRIGGER stock_movement_no_delete
BEFORE DELETE ON stock_movement
BEGIN
    SELECT RAISE(ABORT, 'stock_movement is immutable — create a compensating movement instead');
END;
--> statement-breakpoint

-- 4) transfer_batch: sku партии = sku переброски -----------------------------
CREATE TRIGGER transfer_batch_sku_match_insert
BEFORE INSERT ON transfer_batch
WHEN NEW.batch_sku_id <> (SELECT sku_id FROM transfer WHERE id = NEW.transfer_id)
BEGIN
    SELECT RAISE(ABORT, 'transfer_batch.batch_sku_id must match transfer.sku_id');
END;
--> statement-breakpoint

-- 5) transfer_batch: склад партии = склад-источник переброски ----------------
CREATE TRIGGER transfer_batch_warehouse_match_insert
BEFORE INSERT ON transfer_batch
WHEN NEW.batch_warehouse_id <> (SELECT from_warehouse_id FROM transfer WHERE id = NEW.transfer_id)
BEGIN
    SELECT RAISE(ABORT, 'transfer_batch.batch_warehouse_id must match transfer.from_warehouse_id');
END;
--> statement-breakpoint

-- 6) Те же два правила на UPDATE (защита от подмены) -------------------------
CREATE TRIGGER transfer_batch_sku_match_update
BEFORE UPDATE ON transfer_batch
WHEN NEW.batch_sku_id <> (SELECT sku_id FROM transfer WHERE id = NEW.transfer_id)
BEGIN
    SELECT RAISE(ABORT, 'transfer_batch.batch_sku_id must match transfer.sku_id');
END;
--> statement-breakpoint

CREATE TRIGGER transfer_batch_warehouse_match_update
BEFORE UPDATE ON transfer_batch
WHEN NEW.batch_warehouse_id <> (SELECT from_warehouse_id FROM transfer WHERE id = NEW.transfer_id)
BEGIN
    SELECT RAISE(ABORT, 'transfer_batch.batch_warehouse_id must match transfer.from_warehouse_id');
END;
