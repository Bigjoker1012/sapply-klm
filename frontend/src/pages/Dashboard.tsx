import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

interface Decision {
  id: number;
  'код сырья': string;
  'наименование': string;
  'среднемесячный расход': number;
  'порог закупки': number;
  'остаток Полоцк': number;
  'свободно Липковская': number;
  'в пути': number;
  'плановая потребность': number;
  'доступно': number;
  'закупка': number;
  'статус': string;
}

interface RawMaterial {
  id: number;
  uid: string;
  name: string;
}

interface TransitItem {
  id: number;
  uid: string;
  name: string;
  quantity: number;
  eta: string;
  direction: string;
  status: string;
}

interface UnmatchedItem {
  id: number;
  original_text: string;
  source_type: string;
  file_name: string;
}

interface DashStatus {
  polotsk_last: string | null;
  lipkovskaya_last: string | null;
  transit_count: number;
  unmatched_count: number;
}

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const statusColor: Record<string, string> = {
  'СРОЧНО ЗАКУПАТЬ':      'text-red-400 font-bold',
  'ПЛАНИРОВАТЬ ЗАКУПКУ':  'text-yellow-400 font-semibold',
  'ПЕРЕВЕЗТИ С ЛИПКОВСКОЙ':'text-blue-400 font-semibold',
  'ЗАПАС В НОРМЕ':        'text-green-400',
};

const rowBg: Record<string, string> = {
  'СРОЧНО ЗАКУПАТЬ':      'bg-red-950/40',
  'ПЛАНИРОВАТЬ ЗАКУПКУ':  'bg-yellow-950/30',
  'ПЕРЕВЕЗТИ С ЛИПКОВСКОЙ':'bg-blue-950/30',
  'ЗАПАС В НОРМЕ':        '',
};

export default function Dashboard() {
  const [decisions, setDecisions]       = useState<Decision[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [transit, setTransit]           = useState<TransitItem[]>([]);
  const [unmatched, setUnmatched]       = useState<UnmatchedItem[]>([]);
  const [dashStatus, setDashStatus]     = useState<DashStatus | null>(null);

  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch]             = useState('');
  const [uploading, setUploading]       = useState(false);
  const [showSynonyms, setShowSynonyms] = useState(false);

  // Файлы
  const [polotskFile, setPolotskFile]   = useState<File | null>(null);
  const [recipeFile, setRecipeFile]     = useState<File | null>(null);
  const [polotskStatus, setPolotskStatus] = useState('');
  const [recipeStatus, setRecipeStatus]   = useState('');

  // Форма транзита
  const [transitForm, setTransitForm] = useState({
    rawMaterialId: '', quantity: '', eta: '', direction: ''
  });

  const load = useCallback(async () => {
    try {
      const [dec, raw, tr, unm, st] = await Promise.all([
        axios.get(`${API}/dashboard/decisions`),
        axios.get(`${API}/raw-materials`),
        axios.get(`${API}/in-transit`),
        axios.get(`${API}/upload/unmatched`),
        axios.get(`${API}/dashboard/status`),
      ]);
      setDecisions(dec.data);
      setRawMaterials(raw.data);
      setTransit(tr.data);
      setUnmatched(unm.data);
      setDashStatus(st.data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePolotskUpload = async () => {
    if (!polotskFile) return;
    setUploading(true);
    setPolotskStatus('Обработка...');
    try {
      const fd = new FormData();
      fd.append('file', polotskFile);
      const r = await axios.post(`${API}/upload/polotsk`, fd);
      setPolotskStatus(`✅ ${r.data.message}`);
      setPolotskFile(null);
      load();
    } catch (e: any) {
      setPolotskStatus(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRecipeUpload = async () => {
    if (!recipeFile) return;
    setUploading(true);
    setRecipeStatus('Обработка...');
    try {
      const fd = new FormData();
      fd.append('file', recipeFile);
      const r = await axios.post(`${API}/upload/recipe`, fd);
      setRecipeStatus(`✅ Рецепт «${r.data.recipeName}» загружен. Строк: ${r.data.total}`);
      setRecipeFile(null);
      load();
    } catch (e: any) {
      setRecipeStatus(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleAddTransit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/in-transit`, {
        rawMaterialId: parseInt(transitForm.rawMaterialId),
        quantity: parseFloat(transitForm.quantity),
        eta: transitForm.eta,
        direction: transitForm.direction,
      });
      setTransitForm({ rawMaterialId: '', quantity: '', eta: '', direction: '' });
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Ошибка');
    }
  };

  const handleDeleteTransit = async (id: number) => {
    await axios.delete(`${API}/in-transit/${id}`);
    load();
  };

  const handleConfirmUnmatched = async (item: UnmatchedItem, rawId: number) => {
    await axios.post(`${API}/upload/unmatched/confirm`, { queueId: item.id, rawMaterialId: rawId });
    load();
  };

  const handleExport = () => {
    window.location.href = `${API}/dashboard/export`;
  };

  const filtered = decisions.filter(d => {
    if (filterStatus !== 'all' && d['статус'] !== filterStatus) return false;
    if (search && !d['наименование'].toLowerCase().includes(search.toLowerCase()) &&
        !d['код сырья'].toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('ru-RU') : 'нет данных';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">[ 🏭 ПРОМ-ЗАКУПКА: ПРЕМИКСЫ ]</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>👤 СЗ: Алексей</span>
          <span>📅 {new Date().toLocaleDateString('ru-RU')}</span>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-screen-2xl mx-auto">

        {/* Блок 1: Загрузка документов */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-3">
            ⬇ ПАНЕЛЬ ЗАГРУЗКИ ДОКУМЕНТОВ <span className="text-gray-500 normal-case">(Входные данные)</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Полоцк КХП */}
            <div className="border border-green-700 rounded-lg p-4 bg-gray-800/50">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-semibold text-white">📁 ПОЛОЦК КХП (Остатки)</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Обновлено: {fmtDate(dashStatus?.polotsk_last)}
                  </div>
                  {polotskStatus && (
                    <div className="text-xs mt-1 text-green-300">{polotskStatus}</div>
                  )}
                </div>
                <span className="text-2xl">📊</span>
              </div>
              <input
                type="file" accept=".pdf,.xlsx,.xls"
                onChange={e => { setPolotskFile(e.target.files?.[0] || null); setPolotskStatus(''); }}
                className="text-xs text-gray-300 mb-2 w-full"
              />
              {polotskFile && <p className="text-xs text-gray-400 mb-2">{polotskFile.name}</p>}
              <button
                onClick={handlePolotskUpload}
                disabled={!polotskFile || uploading}
                className="w-full border border-green-500 text-green-400 text-sm py-1.5 rounded hover:bg-green-500/10 disabled:opacity-40 transition"
              >
                {uploading ? 'Обработка...' : 'КНОПКА: Спарсить и обновить'}
              </button>
            </div>

            {/* 1С Минск Липки */}
            <div className="border border-yellow-600 rounded-lg p-4 bg-gray-800/50">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-semibold text-white">🏛 1С МИНСК (Липки)</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Обновлено: {fmtDate(dashStatus?.lipkovskaya_last)}
                  </div>
                </div>
                <span className="text-2xl">🔄</span>
              </div>
              <div className="text-xs text-gray-500 mt-2 mb-3 italic">
                Ручной ввод — блок ниже
              </div>
              <button
                onClick={load}
                className="w-full border border-yellow-500 text-yellow-400 text-sm py-1.5 rounded hover:bg-yellow-500/10 transition"
              >
                КНОПКА: Синхронизировать
              </button>
            </div>

            {/* Рецепт технолога */}
            <div className="border border-blue-600 rounded-lg p-4 bg-gray-800/50">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-semibold text-white">📜 РЕЦЕПТ ТЕХНОЛОГА</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {recipeStatus || 'Загрузите PDF или Excel рецепта'}
                  </div>
                </div>
                <span className="text-2xl">📋</span>
              </div>
              <input
                type="file" accept=".pdf,.xlsx,.xls"
                onChange={e => { setRecipeFile(e.target.files?.[0] || null); setRecipeStatus(''); }}
                className="text-xs text-gray-300 mb-2 w-full"
              />
              {recipeFile && <p className="text-xs text-gray-400 mb-2">{recipeFile.name}</p>}
              <button
                onClick={handleRecipeUpload}
                disabled={!recipeFile || uploading}
                className="w-full border border-blue-500 text-blue-400 text-sm py-1.5 rounded hover:bg-blue-500/10 disabled:opacity-40 transition"
              >
                {uploading ? 'Обработка...' : 'КНОПКА: Разобрать на строки'}
              </button>
            </div>
          </div>
        </section>

        {/* Блок 2: Нераспознанные строки */}
        {unmatched.length > 0 && (
          <section className="bg-yellow-950/40 border border-yellow-600 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-yellow-400 uppercase tracking-wider mb-3">
              ⚠ ТРЕБУЕТ ПРОВЕРКИ — {unmatched.length} строк не распознано
            </h2>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {unmatched.map(item => (
                <UnmatchedRow
                  key={item.id}
                  item={item}
                  rawMaterials={rawMaterials}
                  onConfirm={handleConfirmUnmatched}
                />
              ))}
            </div>
          </section>
        )}

        {/* Блок 3: Сырьё в пути */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-3">
            🚛 СЫРЬЁ В ПУТИ <span className="text-gray-500 normal-case">(Ручной ввод)</span>
          </h2>
          <form onSubmit={handleAddTransit} className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            <select
              value={transitForm.rawMaterialId}
              onChange={e => setTransitForm({...transitForm, rawMaterialId: e.target.value})}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 col-span-2 md:col-span-1"
              required
            >
              <option value="">Выбрать сырьё:</option>
              {rawMaterials.map(rm => (
                <option key={rm.id} value={rm.id}>{rm.name}</option>
              ))}
            </select>
            <input
              type="number" placeholder="Количество, кг"
              value={transitForm.quantity}
              onChange={e => setTransitForm({...transitForm, quantity: e.target.value})}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
              required
            />
            <input
              type="date" placeholder="Дата прихода"
              value={transitForm.eta}
              onChange={e => setTransitForm({...transitForm, eta: e.target.value})}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
              required
            />
            <input
              type="text" placeholder="Направление"
              value={transitForm.direction}
              onChange={e => setTransitForm({...transitForm, direction: e.target.value})}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
            />
            <button
              type="submit"
              className="bg-orange-700 hover:bg-orange-600 text-white text-sm px-3 py-1.5 rounded transition"
            >
              + Добавить поставку
            </button>
          </form>
          {transit.length > 0 && (
            <div className="space-y-1">
              {transit.map(t => (
                <div key={t.id} className="flex items-center gap-3 text-sm text-gray-300 bg-gray-800/50 rounded px-3 py-1.5">
                  <span className="text-yellow-400">⚡</span>
                  <span className="font-medium">{t.name}</span>
                  <span>({fmt(t.quantity)} кг)</span>
                  <span className="text-gray-500">— ожидается</span>
                  <span className="text-blue-400">{new Date(t.eta).toLocaleDateString('ru-RU')}</span>
                  {t.direction && <span className="text-gray-500">→ {t.direction}</span>}
                  <button
                    onClick={() => handleDeleteTransit(t.id)}
                    className="ml-auto text-red-400 hover:text-red-300 text-xs"
                  >
                    ✕ Удалить
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Блок 4: Монитор дефицита */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
            <h2 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider">
              📊 МОНИТОР ДЕФИЦИТА И КОНТРОЛЯ ПОЗИЦИЙ <span className="text-gray-500 normal-case">(Аналитика на лету)</span>
            </h2>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text" placeholder="Поиск сырья..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 w-36"
              />
              <button
                onClick={() => setFilterStatus('all')}
                className={`text-xs px-2 py-1 rounded border ${filterStatus === 'all' ? 'border-gray-400 text-white' : 'border-gray-700 text-gray-400'}`}
              >
                Все позиции
              </button>
              <button
                onClick={() => setFilterStatus('СРОЧНО ЗАКУПАТЬ')}
                className={`text-xs px-2 py-1 rounded border ${filterStatus === 'СРОЧНО ЗАКУПАТЬ' ? 'border-red-500 bg-red-900/30 text-red-300' : 'border-gray-700 text-gray-500'}`}
              >
                🔴 Срочно закупать
              </button>
              <button
                onClick={() => setFilterStatus('ПЕРЕВЕЗТИ С ЛИПКОВСКОЙ')}
                className={`text-xs px-2 py-1 rounded border ${filterStatus === 'ПЕРЕВЕЗТИ С ЛИПКОВСКОЙ' ? 'border-yellow-500 bg-yellow-900/20 text-yellow-300' : 'border-gray-700 text-gray-500'}`}
              >
                🟡 Перевезти из Минска
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-800 text-gray-400 uppercase text-left">
                  <th className="border border-gray-700 px-2 py-2">ID</th>
                  <th className="border border-gray-700 px-2 py-2">Системное имя</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Полоцк КХП, кг</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Липки (Минск)</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">В пути, кг</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Свободный, кг</th>
                  <th className="border border-gray-700 px-2 py-2 text-center">ТЕКУЩИЙ СТАТУС</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-gray-600">Нет данных</td>
                  </tr>
                )}
                {filtered.map((d, idx) => (
                  <tr key={d.id} className={`border-b border-gray-800 hover:bg-gray-800/50 ${rowBg[d['статус']] || ''}`}>
                    <td className="border border-gray-800 px-2 py-2 text-gray-500">{idx + 1}</td>
                    <td className="border border-gray-800 px-2 py-2">
                      <div className="font-medium text-white">{d['код сырья']}</div>
                      <div className="text-gray-400">{d['наименование']}</div>
                    </td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-gray-200">{fmt(d['остаток Полоцк'])}</td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-gray-200">{fmt(d['свободно Липковская'])}</td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-gray-200">{fmt(d['в пути'])}</td>
                    <td className="border border-gray-800 px-2 py-2 text-right font-bold text-white">
                      {fmt(d['доступно'])}
                    </td>
                    <td className="border border-gray-800 px-2 py-2 text-center">
                      <span className={`${statusColor[d['статус']] || 'text-gray-400'}`}>
                        {d['статус'] === 'СРОЧНО ЗАКУПАТЬ' && '🔴 '}
                        {d['статус'] === 'ПЛАНИРОВАТЬ ЗАКУПКУ' && '🟡 '}
                        {d['статус'] === 'ПЕРЕВЕЗТИ С ЛИПКОВСКОЙ' && '🟡 '}
                        {d['статус'] === 'ЗАПАС В НОРМЕ' && '🟢 '}
                        {d['статус']}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Нижняя панель */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 flex flex-wrap gap-3 items-center">
          <span className="text-xs text-gray-400 font-semibold uppercase">⚙ Управление:</span>
          <button
            onClick={() => setShowSynonyms(!showSynonyms)}
            className="text-xs border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-800 transition"
          >
            🔗 Открыть базу синонимов (Мэппинг)
          </button>
          <button
            onClick={load}
            className="text-xs border border-green-700 text-green-400 px-3 py-1.5 rounded hover:bg-green-900/30 transition"
          >
            📊 База Google Sheets: СВЯЗАНО
          </button>
          <button
            onClick={handleExport}
            className="text-xs border border-blue-700 text-blue-400 px-3 py-1.5 rounded hover:bg-blue-900/30 transition"
          >
            ⬇ Скачать отчёт СЗ в Excel
          </button>
        </div>

        {/* Панель синонимов (раскрывается) */}
        {showSynonyms && (
          <SynonymsPanel rawMaterials={rawMaterials} onClose={() => setShowSynonyms(false)} onRefresh={load} />
        )}
      </div>
    </div>
  );
}

// Компонент: строка нераспознанного сырья
function UnmatchedRow({ item, rawMaterials, onConfirm }: {
  item: UnmatchedItem;
  rawMaterials: RawMaterial[];
  onConfirm: (item: UnmatchedItem, rawId: number) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  return (
    <div className="flex items-center gap-2 bg-gray-800 rounded px-3 py-2 text-xs">
      <span className="font-mono text-yellow-300 flex-1">{item.original_text}</span>
      <span className="text-gray-500">[{item.source_type}]</span>
      <select
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
        className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-200"
      >
        <option value="">Выберите сырьё...</option>
        {rawMaterials.map(rm => (
          <option key={rm.id} value={rm.id}>{rm.name}</option>
        ))}
      </select>
      <button
        disabled={!selectedId}
        onClick={() => onConfirm(item, parseInt(selectedId))}
        className="bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded disabled:opacity-40 transition"
      >
        Подтвердить
      </button>
    </div>
  );
}

// Компонент: панель синонимов
function SynonymsPanel({ rawMaterials, onClose, onRefresh }: {
  rawMaterials: RawMaterial[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [synonyms, setSynonyms] = useState<any[]>([]);
  const [form, setForm] = useState({ rawMaterialId: '', synonym: '' });

  useEffect(() => {
    axios.get(`${API}/synonyms`).then(r => setSynonyms(r.data));
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await axios.post(`${API}/synonyms`, { rawMaterialId: parseInt(form.rawMaterialId), synonym: form.synonym });
    setForm({ rawMaterialId: '', synonym: '' });
    const r = await axios.get(`${API}/synonyms`);
    setSynonyms(r.data);
    onRefresh();
  };

  const handleDelete = async (id: number) => {
    await axios.delete(`${API}/synonyms/${id}`);
    setSynonyms(synonyms.filter(s => s.id !== id));
  };

  return (
    <section className="bg-gray-900 border border-purple-700 rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-sm font-semibold text-purple-400 uppercase">🔗 База синонимов (Мэппинг)</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">✕</button>
      </div>

      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <select
          value={form.rawMaterialId}
          onChange={e => setForm({...form, rawMaterialId: e.target.value})}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 flex-1"
          required
        >
          <option value="">Сырьё...</option>
          {rawMaterials.map(rm => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
        </select>
        <input
          type="text" placeholder="Синоним (как в файле)"
          value={form.synonym}
          onChange={e => setForm({...form, synonym: e.target.value})}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 flex-1"
          required
        />
        <button type="submit" className="bg-purple-700 hover:bg-purple-600 text-white text-sm px-3 py-1.5 rounded transition">
          + Добавить
        </button>
      </form>

      <div className="max-h-64 overflow-y-auto space-y-1">
        {synonyms.map(s => (
          <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded px-3 py-1.5 text-xs">
            <span className="text-gray-400">{s.name}</span>
            <span className="text-gray-200 mx-3">→ <span className="font-mono text-purple-300">{s.synonym}</span></span>
            <span className="text-gray-600">[{s.source}]</span>
            <button onClick={() => handleDelete(s.id)} className="ml-3 text-red-500 hover:text-red-400">✕</button>
          </div>
        ))}
        {synonyms.length === 0 && <p className="text-gray-600 text-xs text-center py-4">Синонимы пока не добавлены</p>}
      </div>
    </section>
  );
}
