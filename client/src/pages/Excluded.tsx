import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

interface ExcludedItem {
  text: string;
  source_type: string;
  created_at: string;
}

/**
 * Закладка «Исключённые» — позиции, помеченные как «не сырьё». Это глобальные
 * постоянные исключения: они больше не предлагаются к распознаванию ни при одной
 * загрузке. Экран только для просмотра + кнопка возврата на главную.
 */
export default function Excluded({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<ExcludedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API}/upload/excluded`);
      setItems(res.data ?? []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** ISO-время → «18.05.2026, 14:32» (локаль Москвы). */
  const fmtDateTime = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return iso;
    return dt.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-xs border border-gray-700 text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition"
          >
            ← На главную
          </button>
          <span className="text-lg font-bold text-white">Исключённые позиции</span>
          <span className="text-xs text-gray-500 border border-gray-700 rounded px-2 py-0.5">не сырьё</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          {loading && <span className="text-xs text-blue-400 animate-pulse">загрузка...</span>}
          {error && <span className="text-xs text-red-400" title={error}>⚠ ошибка загрузки</span>}
          <button onClick={load} className="text-xs border border-gray-700 text-gray-400 px-2 py-1 rounded hover:bg-gray-800 transition">
            ↻ Обновить
          </button>
        </div>
      </header>

      <div className="p-4 max-w-screen-2xl mx-auto space-y-4">
        <p className="text-sm text-gray-400">
          Эти позиции были помечены как «не сырьё» и больше не предлагаются к распознаванию.
          Исключения действуют для всех будущих загрузок.
        </p>

        {items.length === 0 ? (
          <div className="text-gray-500 text-sm border border-gray-800 rounded p-6 text-center">
            Список пуст — ничего не исключено.
          </div>
        ) : (
          <div className="border border-gray-800 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Наименование</th>
                  <th className="text-left px-4 py-2 font-medium w-40">Источник</th>
                  <th className="text-left px-4 py-2 font-medium w-48">Исключено</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-t border-gray-800 hover:bg-gray-900/50">
                    <td className="px-4 py-2 text-gray-100">{it.text}</td>
                    <td className="px-4 py-2 text-gray-400">{it.source_type || '—'}</td>
                    <td className="px-4 py-2 text-gray-400">{fmtDateTime(it.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-xs text-gray-600">Всего: {items.length}</div>
      </div>
    </div>
  );
}
