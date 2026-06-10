import { useState } from 'react';
import axios from 'axios';
import { Recipe, fmt, STATUS_STYLE } from './types';

const API = '/api';

type Action = 'plan' | 'archive' | 'cancel';

const ACTION_LABEL: Record<Action, string> = {
  plan: 'В план',
  archive: 'В архив (выработан)',
  cancel: 'Отменить (вернуть сырьё)',
};

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

  const allSelected = recipes.length > 0 && recipes.every(r => sel.has(r.recipe_uid));
  const toggleAll = () => {
    setSel(allSelected ? new Set() : new Set(recipes.map(r => r.recipe_uid)));
  };
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
      `Новая выработка (т) для «${r.full_name || r.code || r.recipe_uid}». Текущая: ${r.batch_t}.\n` +
      `Расход и потребность пересчитаются. Нехватка склада не блокирует — остаток может уйти в минус.`,
      String(r.batch_t || ''),
    );
    if (input == null) return;
    const tons = parseFloat(input.replace(',', '.'));
    if (!Number.isFinite(tons) || tons <= 0) { flash('❌ Некорректное число тонн'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/recipes/${r.recipe_uid}/tons`, { tons });
      flash('✅ Выработка обновлена, остатки и потребность пересчитаны');
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

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-gray-400 mr-auto">
          Выбрано: {sel.size}. Рецепты не удаляются — меняется только статус.
        </span>
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
      </div>
      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  title="Выбрать все" />
              </th>
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
                  <input type="checkbox" checked={sel.has(r.recipe_uid)}
                    onChange={() => toggle(r.recipe_uid)} />
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
                  <button onClick={() => editTons(r)} disabled={busy}
                    className="text-xs text-blue-300 hover:underline mr-3 disabled:opacity-40">Выработка</button>
                  <select
                    value=""
                    disabled={busy}
                    onChange={e => {
                      const a = e.target.value as Action;
                      e.target.value = '';
                      if (a) changeStatus(r.recipe_uid, a);
                    }}
                    className="text-xs bg-gray-800 border border-gray-600 rounded px-1.5 py-1 text-gray-200 disabled:opacity-40">
                    <option value="">Статус ▾</option>
                    <option value="plan">{ACTION_LABEL.plan}</option>
                    <option value="archive">{ACTION_LABEL.archive}</option>
                    <option value="cancel">{ACTION_LABEL.cancel}</option>
                  </select>
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
  );
}
