import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ListPageShell from '../components/ListPageShell';

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
    <ListPageShell
      title="Исключённые позиции"
      badge="не сырьё"
      onBack={onBack}
      loading={loading}
      error={error}
      onRefresh={load}
    >
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
    </ListPageShell>
  );
}
