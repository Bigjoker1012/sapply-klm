import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

interface LiveStockRow {
  raw_uid: string;
  name: string;
  plant_qty: number;
  lip_qty: number;
  base: number;
  consumed: number;
  available: number;
}

interface Recipe {
  recipe_uid: string;
  code: string;
  full_name: string;
  date: string;
  batch_t: number;
  status: string;
  file_name: string;
}

interface Snapshot {
  sheet: string;
  date: string;
  rows: number;
  qty: number;
  source: string;
}

const fmt = (n: number) =>
  (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('ru-RU');

const STATUS_STYLE: Record<string, string> = {
  'в работе': 'bg-green-500/15 text-green-300 border-green-600/40',
  'активен': 'bg-green-500/15 text-green-300 border-green-600/40',
  'отменён': 'bg-yellow-500/15 text-yellow-300 border-yellow-600/40',
  'удалён': 'bg-gray-500/15 text-gray-400 border-gray-600/40',
};

// Легаси-статус «активен» трактуем как «в работе».
const isInWork = (s: string) => s === 'в работе' || s === 'активен';

const SHEET_LABEL: Record<string, string> = {
  PlantStock: 'Полоцк',
  LipStock: 'Липковская',
};

export default function RecipesStock({ onBack }: { onBack?: () => void }) {
  const [live, setLive] = useState<LiveStockRow[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [selRecipes, setSelRecipes] = useState<Set<string>>(new Set());
  const [selSnaps, setSelSnaps] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, r, s] = await Promise.all([
        axios.get(`${API}/stock/live`),
        axios.get(`${API}/recipes`),
        axios.get(`${API}/stock/snapshots`),
      ]);
      setLive(l.data || []);
      setRecipes(r.data || []);
      setSnapshots(s.data || []);
      setSelRecipes(new Set());
      setSelSnaps(new Set());
    } catch (e: any) {
      setMsg(`❌ ${e.response?.data?.error || 'Ошибка загрузки'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  // ─── Рецепты: жизненный цикл ───
  const recipeAction = async (uid: string, action: 'cancel' | 'archive') => {
    const label = action === 'cancel' ? 'Отменить' : 'Удалить';
    if (!confirm(`${label} рецепт? ${action === 'cancel' ? 'Сырьё вернётся в остатки.' : 'Сырьё останется списанным (архив).'}`)) return;
    setBusy(true);
    try {
      await axios.post(`${API}/recipes/${uid}/${action}`);
      flash('✅ Готово');
      await load();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  const editTons = async (r: Recipe) => {
    const input = prompt(
      `Новая выработка (т) для «${r.full_name || r.code || r.recipe_uid}». Текущая: ${r.batch_t}.\n` +
      `При уменьшении лишнее сырьё вернётся в остатки; при увеличении проверим склад.`,
      String(r.batch_t || ''),
    );
    if (input == null) return;
    const tons = parseFloat(input.replace(',', '.'));
    if (!Number.isFinite(tons) || tons <= 0) { flash('❌ Некорректное число тонн'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/recipes/${r.recipe_uid}/tons`, { tons });
      flash('✅ Выработка обновлена, остатки и потребность пересчитаны');
      await load();
    } catch (e: any) {
      const sh = e.response?.status === 409 ? e.response?.data?.shortages : null;
      if (Array.isArray(sh) && sh.length) {
        const list = sh.map((s: any) => `• ${s.name}: нужно ещё ${s.required}, есть ${s.available}`).join('\n');
        alert(`Недостаточно сырья для увеличения выработки:\n${list}`);
      } else {
        flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const bulkRecipes = async (action: 'cancel' | 'archive') => {
    if (!selRecipes.size) return;
    const label = action === 'cancel' ? 'отменить' : 'удалить';
    if (!confirm(`Выбрано ${selRecipes.size}. Действительно ${label}?`)) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API}/recipes/bulk`, { uids: [...selRecipes], action });
      flash(`✅ Обработано: ${r.data.done}`);
      await load();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  // ─── Снимки остатков: групповое удаление ───
  const bulkDeleteSnaps = async () => {
    if (!selSnaps.size) return;
    if (!confirm(`Удалить выбранные снимки остатков (${selSnaps.size})? Действие необратимо.`)) return;
    setBusy(true);
    try {
      const items = [...selSnaps].map(k => {
        const [sheet, date] = k.split('|');
        return { sheet, date };
      });
      const r = await axios.post(`${API}/stock/snapshots/delete`, { items });
      flash(`✅ Удалено строк: ${r.data.removed}`);
      await load();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 text-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-white">Рецепты и остатки</h1>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading || busy}
            className="text-sm border border-gray-600 px-3 py-1.5 rounded hover:bg-gray-700/40 disabled:opacity-40">
            ↻ Обновить
          </button>
          {onBack && (
            <button onClick={onBack}
              className="text-sm border border-gray-600 px-3 py-1.5 rounded hover:bg-gray-700/40">
              ← Назад
            </button>
          )}
        </div>
      </div>

      {msg && <div className="mb-4 text-sm whitespace-pre-line">{msg}</div>}
      {loading && <div className="text-gray-400 text-sm">Загрузка…</div>}

      {/* ─── ЖИВЫЕ ОСТАТКИ ─── */}
      <section className="mb-8">
        <h2 className="font-semibold text-white mb-1">Живые остатки</h2>
        <p className="text-xs text-gray-400 mb-2">
          Полоцк + Липковская − списание рецептов «в работе» и «удалён». Отменённые
          возвращают сырьё. Товары в пути не учитываются.
        </p>
        <div className="overflow-x-auto border border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs">
              <tr>
                <th className="text-left px-3 py-2">Сырьё</th>
                <th className="text-right px-3 py-2">Полоцк</th>
                <th className="text-right px-3 py-2">Липковская</th>
                <th className="text-right px-3 py-2">Списано</th>
                <th className="text-right px-3 py-2">Доступно</th>
              </tr>
            </thead>
            <tbody>
              {live.map(r => (
                <tr key={r.raw_uid} className="border-t border-gray-800">
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right text-gray-400">{fmt(r.plant_qty)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-400">{fmt(r.lip_qty)}</td>
                  <td className="px-3 py-1.5 text-right text-yellow-300">{r.consumed ? '−' + fmt(r.consumed) : '—'}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${r.available < 0 ? 'text-red-400' : 'text-white'}`}>{fmt(r.available)}</td>
                </tr>
              ))}
              {!live.length && !loading && (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">Нет данных по остаткам</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── РЕЦЕПТЫ ─── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-white">Рецепты</h2>
          <div className="flex gap-2">
            <button onClick={() => bulkRecipes('cancel')} disabled={!selRecipes.size || busy}
              className="text-xs border border-yellow-600 text-yellow-300 px-2 py-1 rounded hover:bg-yellow-500/10 disabled:opacity-30">
              Отменить выбранные
            </button>
            <button onClick={() => bulkRecipes('archive')} disabled={!selRecipes.size || busy}
              className="text-xs border border-red-600 text-red-300 px-2 py-1 rounded hover:bg-red-500/10 disabled:opacity-30">
              Удалить выбранные
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="text-left px-3 py-2">Рецепт</th>
                <th className="text-left px-3 py-2">Дата</th>
                <th className="text-right px-3 py-2">Выработка, т</th>
                <th className="text-left px-3 py-2">Статус</th>
                <th className="text-right px-3 py-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map(r => (
                <tr key={r.recipe_uid} className="border-t border-gray-800">
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={selRecipes.has(r.recipe_uid)}
                      onChange={() => toggle(selRecipes, r.recipe_uid, setSelRecipes)} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="text-white">{r.full_name || r.code || r.recipe_uid}</div>
                    {r.code && <div className="text-xs text-gray-500">{r.code}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-gray-400">{r.date || '—'}</td>
                  <td className="px-3 py-1.5 text-right text-gray-300">{r.batch_t ? fmt(r.batch_t) : '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-xs border px-2 py-0.5 rounded ${STATUS_STYLE[r.status] || 'bg-gray-700/30 text-gray-300 border-gray-600'}`}>
                      {r.status || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {isInWork(r.status) ? (
                      <>
                        <button onClick={() => editTons(r)} disabled={busy}
                          className="text-xs text-blue-300 hover:underline mr-3 disabled:opacity-40">Выработка</button>
                        <button onClick={() => recipeAction(r.recipe_uid, 'cancel')} disabled={busy}
                          className="text-xs text-yellow-300 hover:underline mr-3 disabled:opacity-40">Отменить</button>
                        <button onClick={() => recipeAction(r.recipe_uid, 'archive')} disabled={busy}
                          className="text-xs text-red-300 hover:underline disabled:opacity-40">Удалить</button>
                      </>
                    ) : r.status === 'отменён' ? (
                      <button onClick={() => recipeAction(r.recipe_uid, 'archive')} disabled={busy}
                        className="text-xs text-red-300 hover:underline disabled:opacity-40">Удалить</button>
                    ) : (
                      <span className="text-xs text-gray-600">архив</span>
                    )}
                  </td>
                </tr>
              ))}
              {!recipes.length && !loading && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-500">Нет рецептов</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── СНИМКИ ОСТАТКОВ ─── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-white">Загруженные снимки остатков</h2>
          <button onClick={bulkDeleteSnaps} disabled={!selSnaps.size || busy}
            className="text-xs border border-red-600 text-red-300 px-2 py-1 rounded hover:bg-red-500/10 disabled:opacity-30">
            Удалить выбранные
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-2">
          Удаление снимка убирает все его строки из остатков (например, ошибочную загрузку).
        </p>
        <div className="overflow-x-auto border border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="text-left px-3 py-2">Склад</th>
                <th className="text-left px-3 py-2">Дата</th>
                <th className="text-right px-3 py-2">Строк</th>
                <th className="text-right px-3 py-2">Количество</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(s => {
                const key = `${s.sheet}|${s.date}`;
                return (
                  <tr key={key} className="border-t border-gray-800">
                    <td className="px-3 py-1.5 text-center">
                      <input type="checkbox" checked={selSnaps.has(key)}
                        onChange={() => toggle(selSnaps, key, setSelSnaps)} />
                    </td>
                    <td className="px-3 py-1.5">{SHEET_LABEL[s.sheet] || s.sheet}</td>
                    <td className="px-3 py-1.5 text-gray-300">{s.date}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">{s.rows}</td>
                    <td className="px-3 py-1.5 text-right text-gray-300">{fmt(s.qty)}</td>
                  </tr>
                );
              })}
              {!snapshots.length && !loading && (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">Нет загруженных снимков</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
