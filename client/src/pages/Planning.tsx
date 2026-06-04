import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ListPageShell from '../components/ListPageShell';

const API = '/api';

interface PlanRow {
  raw_uid: string;
  name: string;
  unit: string;
  qty_today: number;
  avg_monthly_usage: number | null;
  coefficient: number;
  manual_input: boolean;
  manual_avg_usage: number | null;
}

/** Варианты коэффициента закупки: 0,1 … 1,0 */
const COEF_OPTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : nf.format(n);
const fmtCoef = (n: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

export default function Planning({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<PlanRow[]>(`${API}/planning`);
      setRows(res.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Не удалось загрузить данные планирования');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateLocal = (raw_uid: string, patch: Partial<PlanRow>) =>
    setRows(prev => prev.map(r => (r.raw_uid === raw_uid ? { ...r, ...patch } : r)));

  const save = (raw_uid: string, body: Record<string, unknown>) => {
    axios.patch(`${API}/planning/${encodeURIComponent(raw_uid)}`, body)
      .catch(() => setError('Не удалось сохранить изменение'));
  };

  const onCoef = (r: PlanRow, value: string) => {
    const c = parseFloat(value);
    if (Number.isNaN(c)) return;
    updateLocal(r.raw_uid, { coefficient: c });
    save(r.raw_uid, { coefficient: c });
  };

  const onManualToggle = (r: PlanRow, checked: boolean) => {
    updateLocal(r.raw_uid, {
      manual_input: checked,
      avg_monthly_usage: checked ? r.manual_avg_usage : null,
    });
    save(r.raw_uid, { manual_input: checked });
  };

  const onManualAvgChange = (r: PlanRow, value: string) => {
    const v = value === '' ? null : Math.max(0, parseFloat(value));
    const val = v === null || Number.isNaN(v) ? null : v;
    updateLocal(r.raw_uid, {
      manual_avg_usage: val,
      avg_monthly_usage: r.manual_input ? val : null,
    });
  };

  const onManualAvgBlur = (r: PlanRow) => {
    save(r.raw_uid, { manual_avg_usage: r.manual_avg_usage });
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(r => r.name.toLowerCase().includes(q) || r.raw_uid.toLowerCase().includes(q))
    : rows;

  return (
    <ListPageShell
      title="Планирование закупок"
      badge={`${rows.length} поз.`}
      onBack={onBack}
      loading={loading}
      error={error}
      onRefresh={load}
    >
      <p className="text-sm text-gray-400">
        «Кол-во сегодня» = остатки Полоцк + Липковская + в пути. Среднемесячный расход
        пока вводится вручную — включите «Ручной ввод» и укажите значение (расчёт «за 3 мес / 3»
        появится автоматически, когда будет источник истории расхода).
      </p>

      <input
        type="text"
        placeholder="Поиск по названию или коду..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full max-w-md bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
      />

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-left">
              <th className="px-3 py-2 font-medium">Наименование</th>
              <th className="px-3 py-2 font-medium text-right">Кол-во сегодня</th>
              <th className="px-3 py-2 font-medium text-right">Среднемес. расход</th>
              <th className="px-3 py-2 font-medium text-center">Коэфф. закупки</th>
              <th className="px-3 py-2 font-medium text-center">Ручной ввод</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.raw_uid} className="border-t border-gray-800 hover:bg-gray-900/50">
                <td className="px-3 py-2">
                  <div className="text-gray-100">{r.name}</div>
                  <div className="text-xs text-gray-500">{r.raw_uid}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-200">
                  {fmt(r.qty_today)} <span className="text-xs text-gray-500">{r.unit}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.manual_input ? (
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={r.manual_avg_usage ?? ''}
                      onChange={e => onManualAvgChange(r, e.target.value)}
                      onBlur={() => onManualAvgBlur(r)}
                      placeholder="—"
                      className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-right text-gray-200"
                    />
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <select
                    value={r.coefficient}
                    onChange={e => onCoef(r, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
                  >
                    {COEF_OPTIONS.map(c => (
                      <option key={c} value={c}>{fmtCoef(c)}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={r.manual_input}
                    onChange={e => onManualToggle(r, e.target.checked)}
                    className="w-4 h-4 accent-blue-500 cursor-pointer"
                  />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  {rows.length === 0 ? 'Нет позиций для планирования.' : 'Ничего не найдено.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">Показано: {filtered.length} из {rows.length}</div>
    </ListPageShell>
  );
}
