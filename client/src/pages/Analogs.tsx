import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ListPageShell from '../components/ListPageShell';

const API = '/api';

interface RawOption {
  raw_uid: string;
  full_name: string;
}

interface AnalogItem {
  id: string;
  name: string;
  analog_name: string;
  note?: string;
}

/**
 * Страница «Аналоги / замены сырья». Указывает, какое сырьё можно использовать
 * как замену (учитывается при расчёте дефицита). Вынесена с дашборда в отдельную
 * вкладку — общий паттерн для списков.
 */
export default function Analogs({ onBack }: { onBack: () => void }) {
  const [analogs, setAnalogs] = useState<AnalogItem[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawOption[]>([]);
  const [form, setForm] = useState({ raw_uid: '', analog_raw_uid: '', note: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [anRes, catRes] = await Promise.all([
        axios.get(`${API}/inventory/analogs`),
        axios.get(`${API}/raw-materials`),
      ]);
      setAnalogs(anRes.data ?? []);
      setRawMaterials(
        (catRes.data ?? []).map((m: any) => ({ raw_uid: m.uid, full_name: m.name }))
      );
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.raw_uid === form.analog_raw_uid) return alert('Нельзя добавить сырьё как аналог самого себя');
    await axios.post(`${API}/inventory/analogs`, form);
    setForm({ raw_uid: '', analog_raw_uid: '', note: '' });
    load();
  };

  const handleDelete = async (id: string) => {
    await axios.delete(`${API}/inventory/analogs/${id}`);
    setAnalogs(prev => prev.filter(a => a.id !== id));
  };

  return (
    <ListPageShell
      title="Аналоги / замены"
      badge="замены сырья"
      onBack={onBack}
      loading={loading}
      error={error}
      onRefresh={load}
    >
      <p className="text-sm text-gray-400">
        Укажите, какое сырьё можно использовать как замену. Используется при расчёте дефицита.
      </p>

      <form onSubmit={handleAdd} className="flex gap-2 flex-wrap items-center">
        <select
          value={form.raw_uid}
          onChange={e => setForm({ ...form, raw_uid: e.target.value })}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 flex-1 min-w-40"
          required
        >
          <option value="">Основное сырьё...</option>
          {rawMaterials.map(rm => <option key={rm.raw_uid} value={rm.raw_uid}>{rm.full_name}</option>)}
        </select>
        <span className="text-gray-500 text-sm">→ заменяет</span>
        <select
          value={form.analog_raw_uid}
          onChange={e => setForm({ ...form, analog_raw_uid: e.target.value })}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 flex-1 min-w-40"
          required
        >
          <option value="">Аналог (замена)...</option>
          {rawMaterials.map(rm => <option key={rm.raw_uid} value={rm.raw_uid}>{rm.full_name}</option>)}
        </select>
        <input
          value={form.note}
          onChange={e => setForm({ ...form, note: e.target.value })}
          placeholder="Примечание (необязательно)"
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 flex-1 min-w-32"
        />
        <button type="submit" className="bg-purple-800 hover:bg-purple-700 text-white text-sm px-3 py-1.5 rounded transition">
          + Добавить
        </button>
      </form>

      {analogs.length === 0 ? (
        <div className="text-gray-500 text-sm border border-gray-800 rounded p-6 text-center">
          Аналоги не заданы.
        </div>
      ) : (
        <div className="border border-gray-800 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-64">Основное сырьё</th>
                <th className="text-left px-4 py-2 font-medium">Аналог (замена)</th>
                <th className="text-left px-4 py-2 font-medium w-64">Примечание</th>
                <th className="px-4 py-2 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {analogs.map(a => (
                <tr key={a.id} className="border-t border-gray-800 hover:bg-gray-900/50">
                  <td className="px-4 py-2 text-gray-100">{a.name}</td>
                  <td className="px-4 py-2 text-gray-300">
                    <span className="text-purple-400 mr-2">→</span>{a.analog_name}
                  </td>
                  <td className="px-4 py-2 text-gray-500 italic">{a.note || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDelete(a.id)} className="text-red-500 hover:text-red-400">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-gray-600">Всего: {analogs.length}</div>
    </ListPageShell>
  );
}
