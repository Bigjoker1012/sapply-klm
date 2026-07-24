import { useState, useMemo } from 'react';
import axios from 'axios';
import { Recipe, DeficitRow, Contributor, fmt, STATUS_STYLE } from './types';

const API = '/api';

interface Props {
  raw_uid: string;
  name: string;
  available: number;
  contributors: Contributor[];
  recipes: Recipe[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (m: string) => void;
  reload: () => Promise<void>;
  onClose: () => void;
}

interface Row {
  recipe_uid: string;
  code: string;
  status: string;
  batch_t: number;
  kg_per_t: number;
  total_kg: number;
  allocated_kg: number;
  result_t: number;
}

export default function StockCalculator({
  raw_uid, name, available, contributors, recipes, busy, setBusy, flash, reload, onClose,
}: Props) {
  const recipeMap = useMemo(() => {
    const m = new Map<string, Recipe>();
    recipes.forEach(r => m.set(r.recipe_uid, r));
    return m;
  }, [recipes]);

  const baseRows: Row[] = useMemo(() => {
    const active = contributors.filter(c => {
      const s = (c.status || '').trim().toLowerCase();
      return s === 'план' || s === 'в работе' || s === 'активен';
    });
    return active.map(c => {
      const r = recipeMap.get(c.recipe_uid);
      const batch_t = r?.batch_t || 0;
      const total_kg = c.qty;
      const kg_per_t = batch_t > 0 ? total_kg / batch_t : 0;
      return {
        recipe_uid: c.recipe_uid,
        code: r?.code || c.recipe_name,
        status: c.status,
        batch_t,
        kg_per_t,
        total_kg,
        allocated_kg: total_kg,
        result_t: batch_t,
      };
    }).filter(r => r.kg_per_t > 0).sort((a, b) => b.total_kg - a.total_kg);
  }, [contributors, recipeMap]);

  const totalConsumed = baseRows.reduce((s, r) => s + r.total_kg, 0);

  const [distributeKg, setDistributeKg] = useState(Math.min(available, totalConsumed));
  const [rows, setRows] = useState<Row[]>(baseRows);

  const redistribute = (totalKg: number, sourceRows?: Row[]) => {
    const rs = sourceRows || rows;
    if (totalConsumed <= 0) return rs;
    return rs.map(r => {
      const share = totalKg * (r.total_kg / totalConsumed);
      return { ...r, allocated_kg: Math.round(share * 100) / 100, result_t: r.kg_per_t > 0 ? Math.round((share / r.kg_per_t) * 1000) / 1000 : 0 };
    });
  };

  const handleDistribute = (v: string) => {
    const kg = parseFloat(v.replace(',', '.')) || 0;
    setDistributeKg(kg);
    setRows(redistribute(kg));
  };

  const setAllocated = (idx: number, kgStr: string) => {
    const kg = parseFloat(kgStr.replace(',', '.')) || 0;
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, allocated_kg: kg, result_t: r.kg_per_t > 0 ? Math.round((kg / r.kg_per_t) * 1000) / 1000 : 0 } : r));
  };

  const apply = async () => {
    const changes = rows.filter(r => Math.abs(r.result_t - r.batch_t) > 0.001);
    if (!changes.length) { flash('Нет изменений'); return; }
    setBusy(true);
    try {
      for (const r of changes) {
        await axios.post(`${API}/recipes/${r.recipe_uid}/tons`, { tons: r.result_t });
      }
      flash(`✅ Обновлено ${changes.length} рецепт(ов)`);
      await reload();
      onClose();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  const totalAllocated = rows.reduce((s, r) => s + r.allocated_kg, 0);
  const totalResult = rows.reduce((s, r) => s + r.result_t, 0);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white mb-1">Калькулятор распределения</h3>
        <p className="text-sm text-gray-400 mb-4">
          <span className="text-white">{name}</span> — доступно: <span className={`font-semibold ${available < 0 ? 'text-red-400' : 'text-green-400'}`}>{fmt(available)} кг</span>
          {totalConsumed > 0 && <> · потребляется: <span className="text-yellow-300">{fmt(totalConsumed)} кг</span></>}
        </p>

        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">Распределить до закупки (кг):</label>
          <input type="number" min="0" step="0.1"
            value={distributeKg}
            onChange={e => handleDistribute(e.target.value)}
            className="w-40 bg-gray-700 border border-gray-500 rounded px-3 py-1.5 text-white text-sm" />
        </div>

        <table className="w-full text-xs mb-4">
          <thead className="text-gray-400 border-b border-gray-700">
            <tr>
              <th className="text-left py-1.5 pr-2">Рецепт</th>
              <th className="text-left py-1.5 pr-2">Статус</th>
              <th className="text-right py-1.5 pr-2">План, т</th>
              <th className="text-right py-1.5 pr-2">кг/т</th>
              <th className="text-right py-1.5 pr-2">Нужно, кг</th>
              <th className="text-right py-1.5 pr-2">Выделить, кг</th>
              <th className="text-right py-1.5">Итого, т</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const exceeded = r.allocated_kg > distributeKg;
              return (
                <tr key={r.recipe_uid} className="border-t border-gray-700/50">
                  <td className="py-1.5 pr-2 text-gray-200">{r.code}</td>
                  <td className="py-1.5 pr-2">
                    <span className={`border px-1.5 py-0.5 rounded ${STATUS_STYLE[r.status] || ''}`}>{r.status}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right text-gray-400">{fmt(r.batch_t)}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-400">{fmt(r.kg_per_t)}</td>
                  <td className="py-1.5 pr-2 text-right text-yellow-300">{fmt(r.total_kg)}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <input type="number" min="0" step="0.1"
                      value={r.allocated_kg}
                      onChange={e => setAllocated(i, e.target.value)}
                      className={`w-20 text-right bg-gray-700 border rounded px-1.5 py-0.5 text-white ${exceeded ? 'border-red-500' : 'border-gray-600'}`} />
                  </td>
                  <td className={`py-1.5 text-right font-semibold ${exceeded ? 'text-red-400' : 'text-white'}`}>
                    {fmt(r.result_t)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-gray-600 text-gray-300 font-semibold">
            <tr>
              <td className="py-1.5 pr-2" colSpan={4}>Итого</td>
              <td className="py-1.5 pr-2 text-right text-yellow-300">{fmt(totalConsumed)}</td>
              <td className={`py-1.5 pr-2 text-right ${totalAllocated > distributeKg ? 'text-red-400' : ''}`}>{fmt(totalAllocated)}</td>
              <td className="py-1.5 text-right">{fmt(totalResult)}</td>
            </tr>
          </tfoot>
        </table>

        {totalAllocated > distributeKg && (
          <p className="text-xs text-red-400 mb-3">
            ⚠ Выделено {fmt(totalAllocated)} кг при доступных {fmt(distributeKg)} кг. Уменьшите распределение.
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-600 rounded">
            Отмена
          </button>
          <button onClick={apply} disabled={busy || totalAllocated > distributeKg || totalAllocated === 0}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-40">
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
