import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { LiveStockRow, DeficitRow, Recipe, Snapshot } from './stock/types';
import StockTab from './stock/StockTab';
import RecipesTab from './stock/RecipesTab';
import DeficitTab from './stock/DeficitTab';
import SnapshotsTab from './stock/SnapshotsTab';

const API = '/api';

type SubTab = 'stock' | 'recipes' | 'deficit' | 'snapshots';

const SUBTABS: { key: SubTab; label: string }[] = [
  { key: 'stock', label: 'Остатки' },
  { key: 'recipes', label: 'Рецепты' },
  { key: 'deficit', label: 'Дефицит / Закупка' },
  { key: 'snapshots', label: 'Снимки остатков' },
];

export default function RecipesStock({ onBack }: { onBack?: () => void }) {
  const [sub, setSub] = useState<SubTab>('stock');
  const [live, setLive] = useState<LiveStockRow[]>([]);
  const [deficit, setDeficit] = useState<DeficitRow[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, d, r, s] = await Promise.all([
        axios.get(`${API}/stock/live`),
        axios.get(`${API}/stock/deficit`),
        axios.get(`${API}/recipes`),
        axios.get(`${API}/stock/snapshots`),
      ]);
      setLive(l.data || []);
      setDeficit(d.data || []);
      setRecipes(r.data || []);
      setSnapshots(s.data || []);
    } catch (e: any) {
      setMsg(`❌ ${e.response?.data?.error || 'Ошибка загрузки'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  const criticalCount = deficit.filter(d => d.signal === 'critical').length;

  const subCls = (active: boolean) =>
    `px-3 py-1.5 text-sm rounded-t border-b-2 transition ${
      active ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'
    }`;

  return (
    <div className="max-w-6xl mx-auto p-6 text-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-white">Склад и рецепты</h1>
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

      <div className="flex gap-1 border-b border-gray-800 mb-4">
        {SUBTABS.map(t => (
          <button key={t.key} className={subCls(sub === t.key)} onClick={() => setSub(t.key)}>
            {t.label}
            {t.key === 'deficit' && criticalCount > 0 && (
              <span className="ml-1.5 text-xs bg-red-500/20 text-red-300 border border-red-600/50 px-1.5 rounded-full">
                {criticalCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {msg && <div className="mb-4 text-sm whitespace-pre-line">{msg}</div>}
      {loading && <div className="text-gray-400 text-sm mb-3">Загрузка…</div>}

      {sub === 'stock' && <StockTab live={live} deficit={deficit} recipes={recipes} loading={loading} busy={busy} setBusy={setBusy} flash={flash} reload={load} />}
      {sub === 'recipes' && (
        <RecipesTab recipes={recipes} loading={loading} busy={busy}
          setBusy={setBusy} flash={flash} reload={load} />
      )}
      {sub === 'deficit' && <DeficitTab deficit={deficit} recipes={recipes} loading={loading} busy={busy} setBusy={setBusy} flash={flash} reload={load} />}
      {sub === 'snapshots' && (
        <SnapshotsTab snapshots={snapshots} loading={loading} busy={busy}
          setBusy={setBusy} flash={flash} reload={load} />
      )}
    </div>
  );
}
