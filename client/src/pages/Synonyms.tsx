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
  canonical_raw_uid?: string;
  name: string;
  synonym: string;
  source: string;
  resolved?: boolean;
}

/** Группирует синонимы по raw_uid */
function groupByRaw(syns: SynonymItem[]): Map<string, SynonymItem[]> {
  const map = new Map<string, SynonymItem[]>();
  for (const s of syns) {
    const key = s.canonical_raw_uid || '_unresolved';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

export default function Synonyms({ onBack }: { onBack: () => void }) {
  const [synonyms, setSynonyms] = useState<SynonymItem[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newSynonym, setNewSynonym] = useState('');
  const [search, setSearch] = useState('');

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
        (catRes.data ?? []).map((m: any) => ({ raw_uid: m.uid || m.id, full_name: m.name }))
      );
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = groupByRaw(synonyms);

  const toggle = (uid: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const handleAdd = async (raw_uid: string) => {
    if (!newSynonym.trim()) return;
    await axios.post(`${API}/synonyms`, { raw_uid, synonym: newSynonym.trim(), source: 'manual' });
    setNewSynonym('');
    setAddingTo(null);
    load();
  };

  const handleDelete = async (id: string) => {
    await axios.delete(`${API}/synonyms/${id}`);
    setSynonyms(prev => prev.filter(s => s.id !== id));
  };

  // Фильтр поиска
  const filtered = rawMaterials.filter(rm => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const syns = grouped.get(rm.raw_uid) || [];
    return rm.full_name.toLowerCase().includes(q) ||
           rm.raw_uid.toLowerCase().includes(q) ||
           syns.some(s => s.synonym.toLowerCase().includes(q));
  });

  const totalSynonyms = synonyms.length;

  return (
    <ListPageShell
      title="База синонимов"
      badge="маппинг"
      onBack={onBack}
      loading={loading}
      error={error}
      onRefresh={load}
    >
      <p className="text-sm text-gray-400 mb-3">
        Сопоставление названий из файлов с позициями каталога. Клик по позиции —展开 список синонимов.
      </p>

      {/* Поиск */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию или синониму..."
          className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 flex-1"
        />
        <span className="text-xs text-gray-500 self-center">Всего: {totalSynonyms}</span>
      </div>

      {/* Список позиций */}
      <div className="border border-gray-800 rounded overflow-hidden">
        <div className="bg-gray-900 text-gray-400 flex text-xs font-medium">
          <div className="px-4 py-2 w-12">#</div>
          <div className="px-4 py-2 flex-1">Позиция каталога</div>
          <div className="px-4 py-2 w-20 text-center">Синонимы</div>
        </div>

        {filtered.map((rm, idx) => {
          const syns = grouped.get(rm.raw_uid) || [];
          const isOpen = expanded.has(rm.raw_uid);
          const isAdding = addingTo === rm.raw_uid;

          return (
            <div key={rm.raw_uid} className="border-t border-gray-800">
              {/* Строка позиции */}
              <div
                className="flex items-center text-sm cursor-pointer hover:bg-gray-900/50 transition"
                onClick={() => toggle(rm.raw_uid)}
              >
                <div className="px-4 py-2 text-gray-600 w-12">{idx + 1}</div>
                <div className="px-4 py-2 flex-1 text-gray-200">
                  <span className="font-mono text-gray-500 mr-2">{rm.raw_uid}</span>
                  {rm.full_name}
                </div>
                <div className="px-4 py-2 w-20 text-center">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${syns.length > 0 ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                    {syns.length}
                  </span>
                </div>
                <div className="px-2 py-2 text-gray-600 text-xs">
                  {isOpen ? '▲' : '▼'}
                </div>
              </div>

              {/* Развернутый блок синонимов */}
              {isOpen && (
                <div className="bg-gray-950 border-t border-gray-800 px-4 py-3">
                  {syns.length > 0 ? (
                    <div className="space-y-1 mb-2">
                      {syns.map(s => (
                        <div key={s.id} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-gray-300 bg-gray-800 rounded px-2 py-0.5">
                            {s.synonym}
                          </span>
                          <span className="text-gray-600">{s.source || 'manual'}</span>
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="text-red-500 hover:text-red-400 ml-auto"
                            title="Удалить синоним"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600 mb-2">Синонимов нет</p>
                  )}

                  {/* Форма добавления */}
                  {isAdding ? (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={newSynonym}
                        onChange={e => setNewSynonym(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleAdd(rm.raw_uid);
                          if (e.key === 'Escape') { setAddingTo(null); setNewSynonym(''); }
                        }}
                        placeholder="Новый синоним..."
                        className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 flex-1"
                      />
                      <button
                        onClick={() => handleAdd(rm.raw_uid)}
                        className="bg-green-700 hover:bg-green-600 text-white text-xs px-2 py-1 rounded"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => { setAddingTo(null); setNewSynonym(''); }}
                        className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1"
                      >
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingTo(rm.raw_uid); setNewSynonym(''); }}
                      className="text-xs text-green-400 hover:text-green-300"
                    >
                      + Добавить синоним
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-gray-500 text-sm p-6 text-center border-t border-gray-800">
            {search ? 'Ничего не найдено' : 'Сырьё не найдено'}
          </div>
        )}
      </div>
    </ListPageShell>
  );
}
