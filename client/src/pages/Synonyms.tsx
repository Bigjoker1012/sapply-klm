import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ListPageShell from '../components/ListPageShell';

const API = '/api';

interface RawOption {
  raw_uid: string;
  full_name: string;
}

interface SynonymItem {
  id: string;
  name: string;
  synonym: string;
  source: string;
  resolved?: boolean;
}

/**
 * Страница «База синонимов (маппинг)». Сопоставляет название из файла с позицией
 * каталога. Вынесена с дашборда в отдельную вкладку — общий паттерн для списков.
 */
export default function Synonyms({ onBack }: { onBack: () => void }) {
  const [synonyms, setSynonyms] = useState<SynonymItem[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawOption[]>([]);
  const [form, setForm] = useState({ raw_uid: '', synonym: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [synRes, catRes] = await Promise.all([
        axios.get(`${API}/synonyms`),
        axios.get(`${API}/raw-materials`),
      ]);
      setSynonyms(synRes.data ?? []);
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
    await axios.post(`${API}/synonyms`, { raw_uid: form.raw_uid, synonym: form.synonym });
    setForm({ raw_uid: '', synonym: '' });
    load();
  };

  const handleDelete = async (id: string) => {
    await axios.delete(`${API}/synonyms/${id}`);
    setSynonyms(prev => prev.filter(s => s.id !== id));
  };

  return (
    <ListPageShell
      title="База синонимов"
      badge="маппинг"
      onBack={onBack}
      loading={loading}
      error={error}
      onRefresh={load}
    >
      <p className="text-sm text-gray-400">
        Сопоставление названий из загружаемых файлов с позициями каталога сырья.
      </p>

      <form onSubmit={handleAdd} className="flex gap-2 flex-wrap">
        <select
          value={form.raw_uid}
          onChange={e => setForm({ ...form, raw_uid: e.target.value })}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 flex-1 min-w-48"
          required
        >
          <option value="">Выбрать сырьё...</option>
          {rawMaterials.map(rm => <option key={rm.raw_uid} value={rm.raw_uid}>{rm.full_name}</option>)}
        </select>
        <input
          value={form.synonym}
          onChange={e => setForm({ ...form, synonym: e.target.value })}
          placeholder="Синоним (из файла)"
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 flex-1 min-w-48"
          required
        />
        <button type="submit" className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded transition">
          + Добавить
        </button>
      </form>

      {synonyms.length === 0 ? (
        <div className="text-gray-500 text-sm border border-gray-800 rounded p-6 text-center">
          Синонимов нет.
        </div>
      ) : (
        <div className="border border-gray-800 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-64">Позиция каталога</th>
                <th className="text-left px-4 py-2 font-medium">Синоним (из файла)</th>
                <th className="text-left px-4 py-2 font-medium w-32">Источник</th>
                <th className="px-4 py-2 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {synonyms.map(s => (
                <tr key={s.id} className={`border-t border-gray-800 hover:bg-gray-900/50 ${s.resolved === false ? 'bg-amber-900/20' : ''}`}>
                  <td className={`px-4 py-2 ${s.resolved === false ? 'text-amber-500 italic' : 'text-gray-300'}`} title={s.resolved === false ? 'Синоним не привязан к позиции каталога' : s.name}>
                    {s.name}
                  </td>
                  <td className="px-4 py-2 font-mono text-gray-100">{s.synonym}</td>
                  <td className="px-4 py-2 text-gray-500">{s.source || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDelete(s.id)} className="text-red-500 hover:text-red-400">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-gray-600">Всего: {synonyms.length}</div>
    </ListPageShell>
  );
}
