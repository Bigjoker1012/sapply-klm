import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ListPageShell from '../components/ListPageShell';

const API = '/api';

interface ExpiryItem {
  raw_uid: string;
  name: string;
  batch_code: string;
  vendor_name: string;
  qty: number;
  unit: string;
  expiry_date: string | null;
  manufacture_date: string | null;
  days_remaining: number;
  status: string;
  color: string;
}

const STATUS_CONFIG = {
  expired: { label: 'ПРОСРОЧЕНО', bg: 'bg-red-900/50', border: 'border-red-600', text: 'text-red-400', icon: '❌' },
  urgent: { label: 'СРОЧНО', bg: 'bg-red-900/30', border: 'border-red-500', text: 'text-red-400', icon: '🔴' },
  warning: { label: 'ВНИМАНИЕ', bg: 'bg-yellow-900/30', border: 'border-yellow-500', text: 'text-yellow-400', icon: '🟡' },
  ok: { label: 'НОРМА', bg: 'bg-green-900/30', border: 'border-green-600', text: 'text-green-400', icon: '🟢' },
  unknown: { label: 'НЕТ ДАННЫХ', bg: 'bg-gray-800/50', border: 'border-gray-600', text: 'text-gray-400', icon: '⚪' },
};

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ru-RU');
  } catch {
    return d;
  }
};

const fmtDays = (days: number) => {
  if (days < 0) return `просрочено ${Math.abs(days)} дн.`;
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days < 5) return `${days} дн.`;
  if (days < 30) return `${days} дн.`;
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  if (remainingDays === 0) return `${months} мес.`;
  return `${months} мес. ${remainingDays} дн.`;
};

export default function Expiry({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<ExpiryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<ExpiryItem[]>(`${API}/expiry`);
      setItems(res.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Не удалось загрузить данные по срокам');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const filtered = items.filter(item => {
    // Search filter
    if (q && !item.name.toLowerCase().includes(q) && !item.raw_uid.toLowerCase().includes(q) && !item.batch_code.toLowerCase().includes(q)) {
      return false;
    }
    // Status filter
    if (filter !== 'all' && item.status !== filter) {
      return false;
    }
    return true;
  });

  // Summary counts
  const counts = {
    expired: items.filter(i => i.status === 'expired').length,
    urgent: items.filter(i => i.status === 'urgent').length,
    warning: items.filter(i => i.status === 'warning').length,
    ok: items.filter(i => i.status === 'ok').length,
    unknown: items.filter(i => i.status === 'unknown').length,
  };

  return (
    <ListPageShell
      title="Сроки годности"
      badge={`${items.length} поз.`}
      onBack={onBack}
      loading={loading}
      error={error}
      onRefresh={load}
    >
      {/* Traffic Light Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {[
          { key: 'expired', label: 'Просрочено', count: counts.expired, color: 'border-red-600 bg-red-950/40' },
          { key: 'urgent', label: 'Срочно (<30 дн.)', count: counts.urgent, color: 'border-red-500 bg-red-950/30' },
          { key: 'warning', label: 'Внимание (30-90 дн.)', count: counts.warning, color: 'border-yellow-500 bg-yellow-950/30' },
          { key: 'ok', label: 'Норма (>90 дн.)', count: counts.ok, color: 'border-green-600 bg-green-950/30' },
          { key: 'unknown', label: 'Нет данных', count: counts.unknown, color: 'border-gray-600 bg-gray-900/30' },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setFilter(filter === s.key ? 'all' : s.key)}
            className={`border rounded-lg p-3 text-left transition hover:opacity-90 ${s.color} ${filter === s.key ? 'ring-2 ring-white' : ''}`}
          >
            <div className="text-2xl font-bold text-white">{s.count}</div>
            <div className="text-xs text-gray-300">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Поиск по названию, коду или партии..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full max-w-md bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 mb-4"
      />

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-left">
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Наименование</th>
              <th className="px-3 py-2 font-medium">Партия</th>
              <th className="px-3 py-2 font-medium text-right">Кол-во</th>
              <th className="px-3 py-2 font-medium">Дата произв.</th>
              <th className="px-3 py-2 font-medium">Срок годности</th>
              <th className="px-3 py-2 font-medium text-right">Осталось</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item, idx) => {
              const config = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.unknown;
              return (
                <tr key={`${item.raw_uid}-${item.batch_code}-${idx}`} className={`border-t border-gray-800 ${config.bg}`}>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${config.text} ${config.border} border`}>
                      {config.icon} {config.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-100">{item.name}</div>
                    <div className="text-xs text-gray-500">{item.raw_uid}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-300">{item.batch_code || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-200">
                    {item.qty.toLocaleString('ru-RU')} <span className="text-xs text-gray-500">{item.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-300">{fmtDate(item.manufacture_date)}</td>
                  <td className="px-3 py-2 text-gray-300">{fmtDate(item.expiry_date)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${config.text}`}>
                    {item.expiry_date ? fmtDays(item.days_remaining) : '—'}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  {items.length === 0 ? 'Нет данных по срокам годности. Загрузите КД Липковской.' : 'Ничего не найдено.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500 mt-2">
        Показано: {filtered.length} из {items.length} | 
        Фильтр: {filter === 'all' ? 'все' : STATUS_CONFIG[filter as keyof typeof STATUS_CONFIG]?.label || filter}
      </div>
    </ListPageShell>
  );
}
