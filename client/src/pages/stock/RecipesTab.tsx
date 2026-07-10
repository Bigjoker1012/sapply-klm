import { useState, useEffect } from 'react';
import axios from 'axios';
import { Recipe, fmt, STATUS_STYLE } from './types';

const API = '/api';

type Action = 'plan' | 'archive' | 'cancel';

const ACTION_LABEL: Record<Action, string> = {
  plan: 'В план',
  archive: 'В архив (выработан)',
  cancel: 'Отменить (вернуть сырьё)',
};

type Filter = 'active' | 'archive' | 'cancelled' | 'all';

const STATUS_CATEGORY: Record<string, Exclude<Filter, 'all'>> = {
  'план': 'active', 'в работе': 'active', 'активен': 'active',
  'архив': 'archive', 'удалён': 'archive',
  'отменён': 'cancelled',
};
const categoryOf = (status: string): Exclude<Filter, 'all'> =>
  STATUS_CATEGORY[String(status || '').trim().toLowerCase()] || 'active';

const FILTER_LABEL: Record<Filter, string> = {
  active: 'Активные', archive: 'Архив', cancelled: 'Отменённые', all: 'Все',
};

type SortDir = 'asc' | 'desc' | null;

export default function RecipesTab({
  recipes, loading, busy, setBusy, flash, reload,
}: {
  recipes: Recipe[];
  loading: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (m: string) => void;
  reload: () => Promise<void>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('active');
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [listExpanded, setListExpanded] = useState(true);

  const counts = recipes.reduce(
    (acc, r) => { acc[categoryOf(r.status)]++; acc.all++; return acc; },
    { active: 0, archive: 0, cancelled: 0, all: 0 } as Record<Filter, number>,
  );
  const view = filter === 'all'
    ? recipes
    : recipes.filter(r => categoryOf(r.status) === filter);

  const sorted = [...view].sort((a, b) => {
    if (!sortDir) return 0;
    const da = a.date || '';
    const db = b.date || '';
    return sortDir === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
  });

  const changeFilter = (f: Filter) => { setFilter(f); setSel(new Set()); setSortDir(null); setListExpanded(true); };

  const toggleSort = () => setSortDir(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc');

  const useCollapse = filter !== 'active';

  useEffect(() => {
    const visible = new Set(sorted.map(r => r.recipe_uid));
    setSel(prev => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => { if (visible.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [recipes, filter, sortDir]);

  const allSelected = view.length > 0 && view.every(r => sel.has(r.recipe_uid));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(view.map(r => r.recipe_uid)));
  const toggle = (uid: string) => {
    const next = new Set(sel);
    next.has(uid) ? next.delete(uid) : next.add(uid);
    setSel(next);
  };

  const changeStatus = async (uid: string, action: Action) => {
    if (action === 'cancel' && !confirm('Отменить рецепт? Сырьё вернётся в остатки.')) return;
    setBusy(true);
    try {
      await axios.post(`${API}/recipes/${uid}/status`, { status: action });
      flash('✅ Статус изменён');
      await reload();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  const editTons = async (r: Recipe) => {
    const input = prompt(
      `Новая выработка (т) для «${r.code || r.full_name || r.recipe_uid}». Текущая: ${r.batch_t}.\n` +
      `Расход и потребность пересчитаются. Нехватка склада не блокирует — остаток может уйти в минус.`,
      String(r.batch_t || ''),
    );
    if (input == null) return;
    const tons = parseFloat(input.replace(',', '.'));
    if (!Number.isFinite(tons) || tons <= 0) { flash('❌ Некорректное число тонн'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/recipes/${r.recipe_uid}/tons`, { tons });
      flash('✅ Выработка обновлена');
      await reload();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  const bulk = async (action: Action) => {
    if (!sel.size) return;
    if (action === 'cancel' && !confirm(`Отменить выбранные (${sel.size})? Сырьё вернётся в остатки.`)) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API}/recipes/bulk`, { uids: [...sel], status: action });
      flash(`✅ Обработано: ${r.data.done}`);
      setSel(new Set());
      await reload();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteRecipe = async (uid: string) => {
    if (!confirm('Удалить рецепт? Это действие необратимо.')) return;
    setBusy(true);
    try {
      await axios.delete(`${API}/recipes/${uid}`);
      flash('✅ Рецепт удалён');
      await reload();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = async () => {
    if (!confirm(`Удалить ВСЕ отменённые рецепты (${counts.cancelled})? Это действие необратимо.`)) return;
    setBusy(true);
    try {
      const cancelledUids = recipes.filter(r => categoryOf(r.status) === 'cancelled').map(r => r.recipe_uid);
      const r = await axios.post(`${API}/recipes/bulk/delete`, { uids: cancelledUids });
      flash(`✅ Удалено: ${r.data.done}`);
      setSel(new Set());
      await reload();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {(['active', 'archive', 'cancelled', 'all'] as Filter[]).map(f => (
          <button key={f} onClick={() => changeFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              filter === f
                ? 'bg-blue-500/15 text-blue-200 border-blue-500/50'
                : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}>
            {FILTER_LABEL[f]}
            <span className="ml-1 text-gray-500">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Панель действий */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-gray-400 mr-auto">
          {sorted.length} рецептов. Выбрано: {sel.size}
        </span>
        {useCollapse && (
          <button onClick={() => setListExpanded(!listExpanded)}
            className="text-xs border border-gray-600 text-gray-300 px-2 py-1 rounded hover:bg-gray-700 transition">
            {listExpanded ? 'Свернуть список' : 'Развернуть список'}
          </button>
        )}
        {filter === 'cancelled' && (
          <>
            <button onClick={() => bulk('cancel')} disabled={!sel.size || busy}
              className="text-xs border border-red-600 text-red-300 px-2 py-1 rounded hover:bg-red-500/10 disabled:opacity-30">
              Удалить выбранные ({sel.size})
            </button>
            <button onClick={deleteAll} disabled={!counts.cancelled || busy}
              className="text-xs border border-red-700 text-red-400 px-2 py-1 rounded hover:bg-red-600/10 disabled:opacity-30">
              Удалить все ({counts.cancelled})
            </button>
          </>
        )}
        {filter === 'active' && (
          <>
            <button onClick={() => bulk('plan')} disabled={!sel.size || busy}
              className="text-xs border border-blue-600 text-blue-300 px-2 py-1 rounded hover:bg-blue-500/10 disabled:opacity-30">
              В план
            </button>
            <button onClick={() => bulk('archive')} disabled={!sel.size || busy}
              className="text-xs border border-purple-600 text-purple-300 px-2 py-1 rounded hover:bg-purple-500/10 disabled:opacity-30">
              В архив
            </button>
            <button onClick={() => bulk('cancel')} disabled={!sel.size || busy}
              className="text-xs border border-yellow-600 text-yellow-300 px-2 py-1 rounded hover:bg-yellow-500/10 disabled:opacity-30">
              Отменить
            </button>
          </>
        )}
      </div>

      {/* Таблица */}
      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  title="Выбрать все" />
              </th>
              <th className="text-left px-3 py-2">Рецепт</th>
              <th className="text-left px-3 py-2 cursor-pointer select-none hover:text-gray-200" onClick={toggleSort}>
                Дата {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : ''}
              </th>
              <th className="text-right px-3 py-2">Выработка, т</th>
              <th className="text-left px-3 py-2">Статус</th>
              <th className="text-right px-3 py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {listExpanded && sorted.map(r => (
              <tr key={r.recipe_uid} className="border-t border-gray-800">
                <td className="px-3 py-1.5 text-center">
                  <input type="checkbox" checked={sel.has(r.recipe_uid)}
                    onChange={() => toggle(r.recipe_uid)} />
                </td>
                <td className="px-3 py-1.5">
                  <div className="text-white">{r.code || r.full_name || r.recipe_uid}</div>
                  {r.full_name && r.full_name !== r.code && (
                    <div className="text-xs text-gray-500">{r.full_name}</div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-gray-400">{r.date || '—'}</td>
                <td className="px-3 py-1.5 text-right text-gray-300">{r.batch_t ? fmt(r.batch_t) : '—'}</td>
                <td className="px-3 py-1.5">
                  <span className={`text-xs border px-2 py-0.5 rounded ${STATUS_STYLE[r.status] || 'bg-gray-700/30 text-gray-300 border-gray-600'}`}>
                    {r.status || '—'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {filter === 'cancelled' ? (
                    <button onClick={() => deleteRecipe(r.recipe_uid)} disabled={busy}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40">Удалить</button>
                  ) : (
                    <>
                      <button onClick={() => editTons(r)} disabled={busy}
                        className="text-xs text-blue-300 hover:underline mr-3 disabled:opacity-40">Выработка</button>
                      <select
                        value="" disabled={busy}
                        onChange={e => { const a = e.target.value as Action; e.target.value = ''; if (a) changeStatus(r.recipe_uid, a); }}
                        className="text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-gray-200 disabled:opacity-40">
                        <option value="">Статус ▾</option>
                        <option value="plan">{ACTION_LABEL.plan}</option>
                        <option value="archive">{ACTION_LABEL.archive}</option>
                        <option value="cancel">{ACTION_LABEL.cancel}</option>
                      </select>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!listExpanded && (
              <tr className="border-t border-gray-800">
                <td colSpan={6} className="px-3 py-2 text-center text-gray-500 text-xs">
                  Список свёрнут ({sorted.length} рецептов)
                </td>
              </tr>
            )}
            {!sorted.length && !loading && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-500">
                {recipes.length ? `Нет рецептов в категории «${FILTER_LABEL[filter]}»` : 'Нет рецептов'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
