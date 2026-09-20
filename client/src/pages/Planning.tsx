import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ListPageShell from '../components/ListPageShell';

const API = '/api';

interface SupplyRow {
  code: string;
  name: string;
  stock: number;
  plantStock: number;
  lipStock: number;
  planNeed: number;
  avg3m: number;
  minStock: number;
  coeff: number;
  targetStock: number;
  stockAfterPlan: number;
  purchaseRec: number;
  signal: string;
  inboundQty: number;
  thresholdMonths: number | null;
  batchKg: number | null;
  leadTimeDays: number | null;
  mode: string | null;
  status: string;
  comment: string | null;
}

type SortKey = 'signal' | 'code' | 'name' | 'stock' | 'planNeed' | 'avg3m' | 'minStock' | 'coeff' | 'targetStock' | 'stockAfterPlan' | 'purchaseRec' | 'mode' | 'status';

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const fmt = (n: number | null | undefined) => n == null || isNaN(n) ? '—' : nf.format(n);
const fmtCoef = (n: number) => n.toFixed(2);

const SIGNAL_META: Record<string, { label: string; cls: string; sort: number }> = {
  critical: { label: 'Critical', cls: 'bg-red-500/15 text-red-400 border-red-500/30', sort: 0 },
  attention: { label: 'Attention', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', sort: 1 },
  ok: { label: 'OK', cls: 'bg-green-500/15 text-green-400 border-green-500/30', sort: 2 },
};

const MODE_LABELS: Record<string, string> = {
  exchange_to_market: 'Биржа → рынок',
  direct: 'Прямая',
  import: 'Импорт',
  on_demand: 'Под заявку',
  do_not_purchase: 'Не закупать',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Активна',
  on_request: 'Под заявку',
  blocked: 'Заблокирована',
};

const COEF_OPTIONS = [0, 0.3, 0.5, 0.75, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

type FilterSignal = 'all' | 'critical' | 'attention' | 'ok';
type FilterHasRec = 'all' | 'yes' | 'no';
type FilterMode = 'all' | string;
type FilterStatus = 'all' | string;

export default function Planning({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<SupplyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('signal');
  const [sortAsc, setSortAsc] = useState(false);
  const [filterSignal, setFilterSignal] = useState<FilterSignal>('all');
  const [filterHasRec, setFilterHasRec] = useState<FilterHasRec>('all');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selected, setSelected] = useState<SupplyRow | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState<Partial<SupplyRow>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<SupplyRow[]>(`${API}/supply/params`);
      setRows(res.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sorting
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'code' || key === 'name'); }
  };

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'signal': cmp = (SIGNAL_META[a.signal]?.sort ?? 3) - (SIGNAL_META[b.signal]?.sort ?? 3); break;
      case 'purchaseRec': cmp = a.purchaseRec - b.purchaseRec; break;
      default: {
        const av = (a as any)[sortKey] ?? '';
        const bv = (b as any)[sortKey] ?? '';
        cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru');
      }
    }
    return sortAsc ? cmp : -cmp;
  });

  // Filtering
  const filtered = sorted.filter(r => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.code.toLowerCase().includes(q)) return false;
    }
    if (filterSignal !== 'all' && r.signal !== filterSignal) return false;
    if (filterHasRec === 'yes' && r.purchaseRec <= 0) return false;
    if (filterHasRec === 'no' && r.purchaseRec > 0) return false;
    if (filterMode !== 'all' && r.mode !== filterMode) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    return true;
  });

  const totalRec = filtered.reduce((s, r) => s + r.purchaseRec, 0);
  const countRec = filtered.filter(r => r.purchaseRec > 0).length;

  // Column header
  const Th = ({ label, k, cls }: { label: string; k: SortKey; cls?: string }) => (
    <th
      className={`px-2 py-2 font-medium cursor-pointer select-none whitespace-nowrap hover:text-white transition ${cls || ''}`}
      onClick={() => onSort(k)}
    >
      {label} {sortKey === k ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  // Save params
  const saveParams = async (code: string, body: Record<string, unknown>) => {
    try {
      await axios.put(`${API}/sku-params/${encodeURIComponent(code)}`, body);
      await load();
      if (selected?.code === code) {
        setSelected(prev => prev ? { ...prev, ...body } as SupplyRow : null);
      }
    } catch (e: any) {
      setError(e.response?.data?.error || 'Ошибка сохранения');
    }
  };

  const openCard = (row: SupplyRow) => {
    setSelected(row);
    setEditMode(false);
    setEditDraft({});
  };

  const startEdit = () => {
    if (!selected) return;
    setEditMode(true);
    setEditDraft({
      minStock: selected.minStock,
      coeff: selected.coeff,
      thresholdMonths: selected.thresholdMonths,
      batchKg: selected.batchKg,
      leadTimeDays: selected.leadTimeDays,
      mode: selected.mode,
      status: selected.status,
      comment: selected.comment,
    });
  };

  const saveEdit = async () => {
    if (!selected) return;
    const body: Record<string, unknown> = {};
    if (editDraft.minStock !== selected.minStock) body.min_stock_kg = editDraft.minStock;
    if (editDraft.coeff !== selected.coeff) body.purchase_coefficient = editDraft.coeff;
    if (editDraft.thresholdMonths !== selected.thresholdMonths) body.purchase_threshold_months = editDraft.thresholdMonths;
    if (editDraft.batchKg !== selected.batchKg) body.purchase_batch_kg = editDraft.batchKg;
    if (editDraft.leadTimeDays !== selected.leadTimeDays) body.lead_time_days = editDraft.leadTimeDays;
    if (editDraft.mode !== selected.mode) body.purchase_mode = editDraft.mode;
    if (editDraft.status !== selected.status) body.purchase_status = editDraft.status;
    if (editDraft.comment !== selected.comment) body.purchase_comment = editDraft.comment;
    if (Object.keys(body).length > 0) await saveParams(selected.code, body);
    setEditMode(false);
    setEditDraft({});
  };

  // CSV export
  const exportCsv = () => {
    const headers = ['SKU', 'Наименование', 'Остаток', 'Расход сегодня', 'Остаток после плана', 'AVG 3M', 'Min Stock', 'Коэфф.', 'Целевой запас', 'Рекомендация', 'Сигнал', 'Режим', 'Статус'];
    const csvRows = filtered.map(r => [
      r.code, `"${r.name}"`, r.stock, r.planNeed, r.stockAfterPlan, r.avg3m, r.minStock, r.coeff, r.targetStock, r.purchaseRec, r.signal, r.mode || '', r.status,
    ].join(';'));
    const csv = '\uFEFF' + headers.join(';') + '\n' + csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'supply_params.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ListPageShell
      title="Закупки"
      badge={`${filtered.length} поз. | ${countRec} на закупку | ${fmt(totalRec)} кг`}
      onBack={onBack}
      loading={loading}
      error={error}
      onRefresh={load}
    >
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text" placeholder="Поиск..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 w-56"
        />
        <select value={filterSignal} onChange={e => setFilterSignal(e.target.value as FilterSignal)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300">
          <option value="all">Все сигналы</option>
          <option value="critical">Critical</option>
          <option value="attention">Attention</option>
          <option value="ok">OK</option>
        </select>
        <select value={filterHasRec} onChange={e => setFilterHasRec(e.target.value as FilterHasRec)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300">
          <option value="all">Все</option>
          <option value="yes">Требуют закупки</option>
          <option value="no">Без закупки</option>
        </select>
        <select value={filterMode} onChange={e => setFilterMode(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300">
          <option value="all">Все режимы</option>
          {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300">
          <option value="all">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={exportCsv} className="ml-auto text-xs border border-gray-700 text-gray-400 px-3 py-1.5 rounded hover:bg-gray-800 transition">
          ↓ CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-left">
              <Th label="Сигнал" k="signal" />
              <Th label="SKU" k="code" />
              <Th label="Наименование" k="name" />
              <Th label="Остаток" k="stock" cls="text-right" />
              <Th label="Расход" k="planNeed" cls="text-right" />
              <Th label="После плана" k="stockAfterPlan" cls="text-right" />
              <Th label="AVG 3M" k="avg3m" cls="text-right" />
              <Th label="Min" k="minStock" cls="text-right" />
              <Th label="Коэфф." k="coeff" cls="text-right" />
              <Th label="Целевой" k="targetStock" cls="text-right" />
              <Th label="Закупка" k="purchaseRec" cls="text-right" />
              <Th label="Режим" k="mode" />
              <Th label="Статус" k="status" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.code} className="border-t border-gray-800 hover:bg-gray-900/50 cursor-pointer" onClick={() => openCard(r)}>
                <td className="px-2 py-1.5">
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${(SIGNAL_META[r.signal]?.cls ?? '')}`}>
                    {SIGNAL_META[r.signal]?.label ?? r.signal}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">{r.code}</td>
                <td className="px-2 py-1.5 text-gray-200 max-w-[200px] truncate">{r.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.stock)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-yellow-300">{r.planNeed > 0 ? fmt(r.planNeed) : '—'}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${r.stockAfterPlan <= r.minStock && r.minStock > 0 ? 'text-red-400' : r.stockAfterPlan < r.targetStock ? 'text-yellow-400' : 'text-green-400'}`}>
                  {fmt(r.stockAfterPlan)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.avg3m)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.minStock)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtCoef(r.coeff)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.targetStock)}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${r.purchaseRec > 0 ? 'text-orange-400' : 'text-gray-500'}`}>
                  {r.purchaseRec > 0 ? fmt(r.purchaseRec) : '—'}
                </td>
                <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">{r.mode ? (MODE_LABELS[r.mode] ?? r.mode) : '—'}</td>
                <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">{STATUS_LABELS[r.status] ?? r.status}</td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={13} className="px-3 py-6 text-center text-gray-500">
                {rows.length === 0 ? 'Нет данных' : 'Ничего не найдено'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Card Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-white">{selected.name}</h3>
                <p className="text-sm text-gray-500">{selected.code}</p>
              </div>
              <div className="flex gap-2">
                {!editMode ? (
                  <button onClick={startEdit} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded">Редактировать</button>
                ) : (
                  <button onClick={saveEdit} className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded">Сохранить</button>
                )}
                <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-white">✕</button>
              </div>
            </div>

            {/* Read-only indicators */}
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Остаток', fmt(selected.stock) + ' кг'],
                ['Расход сегодня', fmt(selected.planNeed) + ' кг'],
                ['После плана', fmt(selected.stockAfterPlan) + ' кг'],
                ['AVG 3M', fmt(selected.avg3m) + ' кг/мес'],
                ['Целевой запас', fmt(selected.targetStock) + ' кг'],
                ['Рекомендация', selected.purchaseRec > 0 ? fmt(selected.purchaseRec) + ' кг' : '—'],
              ].map(([l, v]) => (
                <div key={l} className="bg-gray-800 rounded p-2">
                  <div className="text-[10px] text-gray-500">{l}</div>
                  <div className="text-sm text-white font-medium">{v}</div>
                </div>
              ))}
            </div>

            {/* Editable params */}
            <div className="border-t border-gray-700 pt-3">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">Параметры закупки</h4>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-gray-400">
                  Мин. остаток, кг
                  <input type="number" min={0} step={1}
                    value={editMode ? (editDraft.minStock ?? '') : selected.minStock}
                    disabled={!editMode}
                    onChange={e => setEditDraft(d => ({ ...d, minStock: parseFloat(e.target.value) || 0 }))}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 disabled:opacity-50"
                  />
                </label>
                <label className="text-xs text-gray-400">
                  Коэффициент
                  {editMode ? (
                    <select value={editDraft.coeff} onChange={e => setEditDraft(d => ({ ...d, coeff: parseFloat(e.target.value) }))}
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200">
                      {COEF_OPTIONS.map(c => <option key={c} value={c}>{fmtCoef(c)}</option>)}
                    </select>
                  ) : (
                    <div className="mt-1 text-sm text-white">{fmtCoef(selected.coeff)}</div>
                  )}
                </label>
                <label className="text-xs text-gray-400">
                  Порог закупки, мес
                  <input type="number" min={0} step={0.1}
                    value={editMode ? (editDraft.thresholdMonths ?? '') : (selected.thresholdMonths ?? '')}
                    disabled={!editMode}
                    onChange={e => setEditDraft(d => ({ ...d, thresholdMonths: e.target.value ? parseFloat(e.target.value) : null }))}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 disabled:opacity-50"
                    placeholder="—"
                  />
                </label>
                <label className="text-xs text-gray-400">
                  Партия, кг
                  <input type="number" min={0} step={100}
                    value={editMode ? (editDraft.batchKg ?? '') : (selected.batchKg ?? '')}
                    disabled={!editMode}
                    onChange={e => setEditDraft(d => ({ ...d, batchKg: e.target.value ? parseFloat(e.target.value) : null }))}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 disabled:opacity-50"
                    placeholder="—"
                  />
                </label>
                <label className="text-xs text-gray-400">
                  Lead Time, дни
                  <input type="number" min={0} step={1}
                    value={editMode ? (editDraft.leadTimeDays ?? '') : (selected.leadTimeDays ?? '')}
                    disabled={!editMode}
                    onChange={e => setEditDraft(d => ({ ...d, leadTimeDays: e.target.value ? parseInt(e.target.value) : null }))}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 disabled:opacity-50"
                    placeholder="—"
                  />
                </label>
                <label className="text-xs text-gray-400">
                  Режим закупки
                  {editMode ? (
                    <select value={editDraft.mode ?? ''} onChange={e => setEditDraft(d => ({ ...d, mode: e.target.value || null }))}
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200">
                      <option value="">—</option>
                      {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : (
                    <div className="mt-1 text-sm text-white">{selected.mode ? (MODE_LABELS[selected.mode] ?? selected.mode) : '—'}</div>
                  )}
                </label>
                <label className="text-xs text-gray-400">
                  Статус
                  {editMode ? (
                    <select value={editDraft.status ?? 'active'} onChange={e => setEditDraft(d => ({ ...d, status: e.target.value }))}
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200">
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : (
                    <div className="mt-1 text-sm text-white">{STATUS_LABELS[selected.status] ?? selected.status}</div>
                  )}
                </label>
              </div>
              <label className="mt-3 block text-xs text-gray-400">
                Комментарий
                {editMode ? (
                  <textarea rows={2}
                    value={editDraft.comment ?? ''}
                    onChange={e => setEditDraft(d => ({ ...d, comment: e.target.value || null }))}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
                  />
                ) : (
                  <div className="mt-1 text-sm text-white">{selected.comment || '—'}</div>
                )}
              </label>
            </div>
          </div>
        </div>
      )}
    </ListPageShell>
  );
}
