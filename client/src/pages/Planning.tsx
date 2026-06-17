import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import ListPageShell from '../components/ListPageShell';

const API = '/api';

type Signal = 'ok' | 'control' | 'buy' | 'urgent' | 'none';

interface PlanRow {
  raw_uid: string;
  name: string;
  unit: string;
  qty_today: number;
  inbound_qty: number;
  avg_monthly_usage: number | null;
  coefficient: number;
  manual_input: boolean;
  manual_avg_usage: number | null;
  // Статус и коэффициенты считает сервер (services/planningStatus.ts), тот же
  // расчёт, что и светофор «Главной» — фронт ничего не пересчитывает.
  need_ratio: number | null;
  final: number | null;
  status: Signal;
}

/** Ручной коэф-т (запас под срок поставки): 1,0 … 2,0 */
const COEF_OPTIONS = Array.from({ length: 11 }, (_, i) => Math.round((1 + i * 0.1) * 10) / 10);

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : nf.format(n);
const fmtCoef = (n: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

const STATUS_META: Record<Signal, { label: string; cls: string }> = {
  ok:      { label: 'Норма',           cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  control: { label: 'Контроль',        cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  buy:     { label: 'К закупке',       cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  urgent:  { label: 'Срочная закупка', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  none:    { label: '—',               cls: 'text-gray-600 border-transparent' },
};

export default function Planning({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    // Сохраняем введённое значение в поле, но не используем
    // его в расчёте статуса (статус = «—» пока галочка снята).
    updateLocal(r.raw_uid, { manual_input: checked });
    save(r.raw_uid, { manual_input: checked });
  };

  // Сохраняем расход сразу при вводе (дебаунс 500 мс), а не только по blur —
  // иначе при обновлении страницы несохранённое значение терялось.
  const onManualAvgChange = (r: PlanRow, value: string) => {
    const v = value === '' ? null : Math.max(0, parseFloat(value));
    const val = v === null || Number.isNaN(v) ? null : v;
    updateLocal(r.raw_uid, {
      manual_avg_usage: val,
      avg_monthly_usage: r.manual_input ? val : null,
    });
    if (saveTimers.current[r.raw_uid]) clearTimeout(saveTimers.current[r.raw_uid]);
    saveTimers.current[r.raw_uid] = setTimeout(() => {
      save(r.raw_uid, { manual_avg_usage: val });
      delete saveTimers.current[r.raw_uid];
    }, 500);
  };

  const onManualAvgBlur = (r: PlanRow) => {
    if (saveTimers.current[r.raw_uid]) {
      clearTimeout(saveTimers.current[r.raw_uid]);
      delete saveTimers.current[r.raw_uid];
    }
    save(r.raw_uid, { manual_avg_usage: r.manual_avg_usage });
  };

  // Переключатель «В пути»: ВКЛ → спрашиваем количество и создаём приход
  // (POST /api/in-transit), ВЫКЛ → отменяем все приходы этого сырья. После
  // изменения перезагружаем страницу, чтобы пересчитались остаток/статус.
  const onInTransitToggle = async (r: PlanRow, checked: boolean) => {
    try {
      if (checked) {
        const ans = window.prompt(`Количество «в пути» для «${r.name}» (${r.unit}):`, '');
        if (ans === null) return;
        const qty = parseFloat(ans.replace(',', '.'));
        if (!Number.isFinite(qty) || qty <= 0) {
          setError('Введите положительное количество');
          return;
        }
        await axios.post(`${API}/in-transit`, {
          raw_uid: r.raw_uid,
          raw_name: r.name,
          quantity: qty,
        });
      } else {
        await axios.delete(`${API}/in-transit/by-material/${encodeURIComponent(r.raw_uid)}`);
      }
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Не удалось изменить «в пути»');
    }
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
        «Кол-во сегодня» = остатки Полоцк + Липковская + в пути (выработанные рецепты
        не вычитаются — их расход уже в загруженном остатке). Включите «Ручной ввод»
        и укажите среднемесячный расход — статус считается так:
        <span className="text-gray-300"> коэф-т потребности = наличие ÷ расход</span>,
        затем ÷ ручной коэф-т (запас под срок поставки, по умолчанию 1).
        Итог: <span className="text-green-400">&gt;1,5 норма</span>,
        {' '}<span className="text-yellow-400">1–1,5 контроль</span>,
        {' '}<span className="text-orange-400">0,6–1 к закупке</span>,
        {' '}<span className="text-red-400">&lt;0,6 срочная закупка</span>.
        Для позиций «к закупке»/«срочная» включите «В пути» и укажите заказанное
        количество — оно попадёт в остатки.
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
              <th className="px-3 py-2 font-medium text-center">Ручной коэф-т</th>
              <th className="px-3 py-2 font-medium text-right">Коэф-т потребности</th>
              <th className="px-3 py-2 font-medium text-center">Статус</th>
              <th className="px-3 py-2 font-medium text-center">В пути</th>
              <th className="px-3 py-2 font-medium text-center">Ручной ввод</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const needPurchase = r.status === 'buy' || r.status === 'urgent';
              const inTransit = r.inbound_qty > 0;
              return (
                <tr key={r.raw_uid} className="border-t border-gray-800 hover:bg-gray-900/50">
                  <td className="px-3 py-2">
                    <div className="text-gray-100">{r.name}</div>
                    <div className="text-xs text-gray-500">{r.raw_uid}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-200">
                    {fmt(r.qty_today)} <span className="text-xs text-gray-500">{r.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={r.manual_avg_usage ?? ''}
                      onChange={e => onManualAvgChange(r, e.target.value)}
                      onBlur={() => onManualAvgBlur(r)}
                      placeholder="—"
                      disabled={!r.manual_input}
                      className={`w-24 border rounded px-2 py-1 text-right tabular-nums ${
                        r.manual_input
                          ? 'bg-gray-800 border-gray-700 text-gray-200 cursor-text'
                          : 'bg-gray-900 border-gray-800 text-gray-500 cursor-not-allowed'
                      }`}
                    />
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
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.final === null ? (
                      <span className="text-gray-600">—</span>
                    ) : (
                      <div>
                        <div className="text-gray-200">{fmt(r.final)}</div>
                        <div className="text-xs text-gray-500">потребн. {fmt(r.need_ratio)}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block rounded border px-2 py-0.5 text-xs whitespace-nowrap ${STATUS_META[r.status].cls}`}>
                      {STATUS_META[r.status].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {needPurchase || inTransit ? (
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inTransit}
                          onChange={e => onInTransitToggle(r, e.target.checked)}
                          className="w-4 h-4 accent-blue-500 cursor-pointer"
                        />
                        {inTransit && (
                          <span className="text-xs text-blue-300 tabular-nums">{fmt(r.inbound_qty)}</span>
                        )}
                      </label>
                    ) : (
                      <span className="text-gray-700">—</span>
                    )}
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
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
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
