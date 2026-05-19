import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

interface Decision {
  raw_uid: string;
  name: string;
  avg_monthly_usage: number;
  threshold_qty: number;
  plant_qty: number;
  lip_qty: number;
  inbound_qty: number;
  planned_need: number;
  available_total: number;
  expected_after_plan: number;
  status: string;
  cover_by_transfer: number;
  cover_by_purchase: number;
}

interface RawMaterial {
  raw_uid: string;
  full_name: string;
  short_name: string;
  unit: string;
  avg_monthly_usage: number;
  active: boolean;
}

interface InboundItem {
  id: string;
  raw_uid: string;
  raw_name: string;
  qty: number;
  eta: string;
  destination: string;
  status: string;
}

interface UnmatchedItem {
  id: string;
  original_text: string;
  source_type: string;
  file_name: string;
}

interface DashStatus {
  plant_last_update: string | null;
  active_inbound_count: number;
  unresolved_review_count: number;
}

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const STATUS_RU: Record<string, string> = {
  'Срочно к закупке': 'Срочно к закупке',
  'К закупке': 'К закупке',
  'На контроле': 'На контроле',
  'Норма': 'Норма',
};

const statusColor: Record<string, string> = {
  'Срочно к закупке': 'text-red-400 font-bold',
  'К закупке': 'text-yellow-400 font-semibold',
  'На контроле': 'text-blue-400 font-semibold',
  'Норма': 'text-green-400',
};

const rowBg: Record<string, string> = {
  'Срочно к закупке': 'bg-red-950/40',
  'К закупке': 'bg-yellow-950/30',
  'На контроле': 'bg-blue-950/20',
  'Норма': '',
};

const statusIcon: Record<string, string> = {
  'Срочно к закупке': '🔴',
  'К закупке': '🟡',
  'На контроле': '🔵',
  'Норма': '🟢',
};

export default function Dashboard() {
  const [decisions, setDecisions]       = useState<Decision[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [inbound, setInbound]           = useState<InboundItem[]>([]);
  const [unmatched, setUnmatched]       = useState<UnmatchedItem[]>([]);
  const [dashStatus, setDashStatus]     = useState<DashStatus | null>(null);

  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch]             = useState('');
  const [loading, setLoading]           = useState(false);
  const [loadError, setLoadError]       = useState('');
  const [uploading, setUploading]       = useState(false);
  const [showSynonyms, setShowSynonyms] = useState(false);
  const [showLipForm, setShowLipForm]   = useState(false);

  const [polotskFile, setPolotskFile]     = useState<File | null>(null);
  const [lipFile, setLipFile]             = useState<File | null>(null);
  const [recipeFile, setRecipeFile]       = useState<File | null>(null);
  const [polotskStatus, setPolotskStatus] = useState('');
  const [lipStatus, setLipStatus]         = useState('');
  const [recipeStatus, setRecipeStatus]   = useState('');

  const [inboundForm, setInboundForm] = useState({ raw_uid: '', raw_name: '', qty: '', eta: '', destination: '', document: '' });
  const [lipForm, setLipForm]         = useState({ raw_uid: '', qty_on_hand: '', reserved_qty: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await axios.get(`${API}/dashboard/all`);
      setDecisions(data.decisions ?? []);
      setRawMaterials(data.rawMaterials ?? []);
      setInbound(data.inbound ?? []);
      setUnmatched(data.unmatched ?? []);
      setDashStatus(data.status ?? null);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || String(e);
      setLoadError(msg);
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
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
      setPolotskStatus(`❌ ${e.response?.data?.error || 'Ошибка загрузки'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleLipUpload = async () => {
    if (!lipFile) return;
    setUploading(true);
    setLipStatus('Обработка...');
    try {
      const fd = new FormData();
      fd.append('file', lipFile);
      const r = await axios.post(`${API}/upload/lipkovskaya`, fd);
      setLipStatus(`✅ ${r.data.message}`);
      setLipFile(null);
      load();
    } catch (e: any) {
      setLipStatus(`❌ ${e.response?.data?.error || 'Ошибка загрузки'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRecipeUpload = async () => {
    if (!recipeFile) return;
    setUploading(true);
    setRecipeStatus('Обработка рецепта...');
    try {
      const fd = new FormData();
      fd.append('file', recipeFile);
      const r = await axios.post(`${API}/upload/recipe`, fd);
      setRecipeStatus(`✅ «${r.data.recipeName}» — ${r.data.matched} строк распознано`);
      setRecipeFile(null);
      load();
    } catch (e: any) {
      setRecipeStatus(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleAddInbound = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/in-transit`, {
        raw_uid: inboundForm.raw_uid,
        raw_name: rawMaterials.find(r => r.raw_uid === inboundForm.raw_uid)?.full_name || inboundForm.raw_uid,
        quantity: parseFloat(inboundForm.qty),
        eta: inboundForm.eta,
        direction: inboundForm.destination,
        document: inboundForm.document,
      });
      setInboundForm({ raw_uid: '', raw_name: '', qty: '', eta: '', destination: '', document: '' });
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Ошибка');
    }
  };

  const handleAddLipStock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const total = parseFloat(lipForm.qty_on_hand);
      const reserved = parseFloat(lipForm.reserved_qty || '0');
      await axios.post(`${API}/inventory/lipkovskaya`, {
        raw_uid: lipForm.raw_uid,
        name_from_source: rawMaterials.find(r => r.raw_uid === lipForm.raw_uid)?.full_name || lipForm.raw_uid,
        qty_on_hand: total,
        reserved_qty: reserved,
        free_qty: Math.max(0, total - reserved),
      });
      setLipForm({ raw_uid: '', qty_on_hand: '', reserved_qty: '' });
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Ошибка');
    }
  };

  const handleDeleteInbound = async (id: string) => {
    await axios.delete(`${API}/in-transit/${id}`);
    load();
  };

  const handleConfirmUnmatched = async (item: UnmatchedItem, raw_uid: string) => {
    await axios.post(`${API}/upload/unmatched/confirm`, {
      queueId: item.id,
      raw_uid,
      synonym: item.original_text,
    });
    load();
  };

  const handleExport = () => { window.location.href = `${API}/dashboard/export`; };

  const filtered = decisions.filter(d => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (search && !d.name.toLowerCase().includes(search.toLowerCase()) &&
        !d.raw_uid.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const fmtDate = (d: string | null) => d ? d : 'нет данных';

  const counts = {
    urgent: decisions.filter(d => d.status === 'Срочно к закупке').length,
    buy: decisions.filter(d => d.status === 'К закупке').length,
    watch: decisions.filter(d => d.status === 'На контроле').length,
    ok: decisions.filter(d => d.status === 'Норма').length,
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* ─── HEADER ─── */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">Supply KLM</span>
          <span className="text-xs text-gray-500 border border-gray-700 rounded px-2 py-0.5">Полоцк КХП · Премиксы</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          {loading && <span className="text-xs text-blue-400 animate-pulse">загрузка...</span>}
          {loadError && <span className="text-xs text-red-400" title={loadError}>⚠ ошибка загрузки</span>}
          <span className="text-xs">📅 {new Date().toLocaleDateString('ru-RU')}</span>
          <button onClick={load} className="text-xs border border-gray-700 text-gray-400 px-2 py-1 rounded hover:bg-gray-800 transition">
            ↻ Обновить
          </button>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-screen-2xl mx-auto">

        {/* ─── СВОДКА ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Срочно к закупке', count: counts.urgent, color: 'border-red-700 bg-red-950/30', textColor: 'text-red-400', icon: '🔴' },
            { label: 'К закупке', count: counts.buy, color: 'border-yellow-700 bg-yellow-950/20', textColor: 'text-yellow-400', icon: '🟡' },
            { label: 'На контроле', count: counts.watch, color: 'border-blue-700 bg-blue-950/20', textColor: 'text-blue-400', icon: '🔵' },
            { label: 'Норма', count: counts.ok, color: 'border-green-800 bg-green-950/20', textColor: 'text-green-400', icon: '🟢' },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => setFilterStatus(filterStatus === s.label ? 'all' : s.label)}
              className={`border rounded-lg p-3 text-left transition hover:opacity-90 ${s.color} ${filterStatus === s.label ? 'ring-1 ring-white/20' : ''}`}
            >
              <div className="text-2xl font-bold text-white">{s.count}</div>
              <div className={`text-xs font-medium ${s.textColor}`}>{s.icon} {s.label}</div>
            </button>
          ))}
        </div>

        {/* ─── ЗАГРУЗКА ДОКУМЕНТОВ ─── */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h2 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-3">
            ⬇ Загрузка документов
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Полоцк КХП */}
            <div className="border border-green-800 rounded-lg p-4 bg-gray-800/50">
              <div className="font-semibold text-white text-sm mb-1">📁 Полоцк КХП (Остатки)</div>
              <div className="text-xs text-gray-400 mb-2">
                Обновлено: {fmtDate(dashStatus?.plant_last_update)}
              </div>
              {polotskStatus && (
                <div className={`text-xs mb-2 ${polotskStatus.startsWith('✅') ? 'text-green-300' : 'text-red-300'}`}>{polotskStatus}</div>
              )}
              <input
                type="file" accept=".pdf,.xlsx,.xls"
                onChange={e => { setPolotskFile(e.target.files?.[0] || null); setPolotskStatus(''); }}
                className="text-xs text-gray-300 mb-2 w-full"
              />
              {polotskFile && <p className="text-xs text-gray-400 mb-2 truncate">{polotskFile.name}</p>}
              <button
                onClick={handlePolotskUpload}
                disabled={!polotskFile || uploading}
                className="w-full border border-green-600 text-green-400 text-sm py-1.5 rounded hover:bg-green-500/10 disabled:opacity-40 transition"
              >
                {uploading ? 'Обработка...' : 'Загрузить и распознать'}
              </button>
            </div>

            {/* Липковская — Excel + ручной ввод */}
            <div className="border border-yellow-700 rounded-lg p-4 bg-gray-800/50">
              <div className="font-semibold text-white text-sm mb-1">🏛 Липковская (Минск)</div>
              {lipStatus && (
                <div className={`text-xs mb-2 ${lipStatus.startsWith('✅') ? 'text-green-300' : 'text-red-300'}`}>{lipStatus}</div>
              )}
              <input
                type="file" accept=".xlsx,.xls"
                onChange={e => { setLipFile(e.target.files?.[0] || null); setLipStatus(''); }}
                className="text-xs text-gray-300 mb-2 w-full"
              />
              {lipFile && <p className="text-xs text-gray-400 mb-2 truncate">{lipFile.name}</p>}
              <button
                onClick={handleLipUpload}
                disabled={!lipFile || uploading}
                className="w-full border border-yellow-600 text-yellow-400 text-sm py-1.5 rounded hover:bg-yellow-500/10 disabled:opacity-40 transition mb-2"
              >
                {uploading && lipFile ? 'Обработка...' : 'Загрузить Excel'}
              </button>
              <button
                onClick={() => setShowLipForm(!showLipForm)}
                className="w-full border border-gray-600 text-gray-400 text-xs py-1 rounded hover:bg-gray-700 transition"
              >
                {showLipForm ? '▲ Скрыть ручной ввод' : '+ Ввести вручную'}
              </button>
            </div>

            {/* Рецепт */}
            <div className="border border-blue-700 rounded-lg p-4 bg-gray-800/50">
              <div className="font-semibold text-white text-sm mb-1">📜 Рецепт технолога</div>
              <div className="text-xs text-gray-400 mb-2">
                {recipeStatus || 'Загрузите PDF или Excel'}
              </div>
              {recipeStatus && (
                <div className={`text-xs mb-2 ${recipeStatus.startsWith('✅') ? 'text-green-300' : 'text-red-300'}`}>{recipeStatus}</div>
              )}
              <input
                type="file" accept=".pdf,.xlsx,.xls"
                onChange={e => { setRecipeFile(e.target.files?.[0] || null); setRecipeStatus(''); }}
                className="text-xs text-gray-300 mb-2 w-full"
              />
              {recipeFile && <p className="text-xs text-gray-400 mb-2 truncate">{recipeFile.name}</p>}
              <button
                onClick={handleRecipeUpload}
                disabled={!recipeFile || uploading}
                className="w-full border border-blue-600 text-blue-400 text-sm py-1.5 rounded hover:bg-blue-500/10 disabled:opacity-40 transition"
              >
                {uploading ? 'Обработка...' : 'Разобрать на строки'}
              </button>
            </div>
          </div>

          {/* Форма ввода остатков Липковской */}
          {showLipForm && (
            <form onSubmit={handleAddLipStock} className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 bg-gray-800 rounded-lg p-3">
              <select
                value={lipForm.raw_uid}
                onChange={e => setLipForm({ ...lipForm, raw_uid: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 col-span-2"
                required
              >
                <option value="">Выбрать сырьё...</option>
                {rawMaterials.map(rm => (
                  <option key={rm.raw_uid} value={rm.raw_uid}>{rm.full_name}</option>
                ))}
              </select>
              <input
                type="number" placeholder="Всего, кг" step="0.01"
                value={lipForm.qty_on_hand}
                onChange={e => setLipForm({ ...lipForm, qty_on_hand: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
                required
              />
              <input
                type="number" placeholder="Зарезервировано, кг" step="0.01"
                value={lipForm.reserved_qty}
                onChange={e => setLipForm({ ...lipForm, reserved_qty: e.target.value })}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
              />
              <button
                type="submit"
                className="col-span-2 md:col-span-4 bg-yellow-700 hover:bg-yellow-600 text-white text-sm py-1.5 rounded transition"
              >
                Сохранить остаток Липковской
              </button>
            </form>
          )}
        </section>

        {/* ─── НЕРАСПОЗНАННЫЕ СТРОКИ ─── */}
        {unmatched.length > 0 && (
          <section className="bg-yellow-950/40 border border-yellow-700 rounded-lg p-4">
            <h2 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-3">
              ⚠ Требует проверки — {unmatched.length} строк не распознано
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

        {/* ─── СЫРЬЁ В ПУТИ ─── */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h2 className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">
            🚛 Сырьё в пути ({inbound.length}) — ручной ввод
          </h2>
          <form onSubmit={handleAddInbound} className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
            <select
              value={inboundForm.raw_uid}
              onChange={e => setInboundForm({ ...inboundForm, raw_uid: e.target.value })}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 col-span-2 md:col-span-2"
              required
            >
              <option value="">Выбрать сырьё...</option>
              {rawMaterials.map(rm => (
                <option key={rm.raw_uid} value={rm.raw_uid}>{rm.full_name}</option>
              ))}
            </select>
            <input
              type="number" placeholder="Кол-во, кг" step="0.01"
              value={inboundForm.qty}
              onChange={e => setInboundForm({ ...inboundForm, qty: e.target.value })}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
              required
            />
            <input
              type="date" placeholder="Дата прихода"
              value={inboundForm.eta}
              onChange={e => setInboundForm({ ...inboundForm, eta: e.target.value })}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
              required
            />
            <input
              type="text" placeholder="Документ / примечание"
              value={inboundForm.document}
              onChange={e => setInboundForm({ ...inboundForm, document: e.target.value })}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
            />
            <button
              type="submit"
              className="bg-orange-700 hover:bg-orange-600 text-white text-sm px-3 py-1.5 rounded transition"
            >
              + Добавить
            </button>
          </form>
          {inbound.length > 0 && (
            <div className="space-y-1">
              {inbound.map(t => (
                <div key={t.id} className="flex items-center gap-3 text-xs text-gray-300 bg-gray-800/50 rounded px-3 py-1.5">
                  <span className="font-medium text-white truncate max-w-48">{t.raw_name || t.raw_uid}</span>
                  <span className="text-yellow-300">{fmt(t.qty)} кг</span>
                  <span className="text-gray-500">→</span>
                  <span className="text-blue-300">{t.eta}</span>
                  {t.destination && <span className="text-gray-500">{t.destination}</span>}
                  <span className={`ml-auto px-1.5 py-0.5 rounded text-xs ${t.status === 'в пути' ? 'bg-orange-900/50 text-orange-300' : 'bg-gray-700 text-gray-300'}`}>
                    {t.status}
                  </span>
                  <button
                    onClick={() => handleDeleteInbound(t.id)}
                    className="text-red-400 hover:text-red-300 text-xs ml-1"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── МОНИТОР РЕШЕНИЙ ─── */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
            <h2 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">
              📊 Монитор закупок — {filtered.length} из {decisions.length} позиций
            </h2>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text" placeholder="Поиск сырья..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 w-40"
              />
              {filterStatus !== 'all' && (
                <button
                  onClick={() => setFilterStatus('all')}
                  className="text-xs border border-gray-600 text-gray-400 px-2 py-1 rounded hover:bg-gray-800 transition"
                >
                  × Сбросить фильтр
                </button>
              )}
              <button
                onClick={handleExport}
                className="text-xs border border-blue-700 text-blue-400 px-3 py-1 rounded hover:bg-blue-900/30 transition"
              >
                ⬇ Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-800 text-gray-400 uppercase text-left">
                  <th className="border border-gray-700 px-2 py-2">№</th>
                  <th className="border border-gray-700 px-2 py-2">Наименование</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Полоцк, кг</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Липк-я, кг</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">В пути, кг</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Потребность</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Ост. после плана</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Переброска</th>
                  <th className="border border-gray-700 px-2 py-2 text-right">Закупить</th>
                  <th className="border border-gray-700 px-2 py-2 text-center">Статус</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-gray-600">
                      {loading
                        ? 'Загрузка данных из Google Sheets...'
                        : loadError
                          ? <span className="text-red-400">Ошибка: {loadError}</span>
                          : 'Нет данных. Загрузите остатки и рецепт.'}
                    </td>
                  </tr>
                )}
                {filtered.map((d, idx) => (
                  <tr
                    key={d.raw_uid}
                    className={`border-b border-gray-800 hover:bg-gray-800/50 transition ${rowBg[d.status] || ''}`}
                  >
                    <td className="border border-gray-800 px-2 py-2 text-gray-500">{idx + 1}</td>
                    <td className="border border-gray-800 px-2 py-2">
                      <div className="font-medium text-white">{d.name}</div>
                      <div className="text-gray-500 text-xs">{d.raw_uid}</div>
                    </td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-gray-200">{fmt(d.plant_qty)}</td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-gray-200">{fmt(d.lip_qty)}</td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-gray-200">{fmt(d.inbound_qty)}</td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-gray-400">{fmt(d.planned_need)}</td>
                    <td className={`border border-gray-800 px-2 py-2 text-right font-semibold ${d.expected_after_plan < 0 ? 'text-red-400' : d.expected_after_plan < d.threshold_qty ? 'text-yellow-400' : 'text-white'}`}>
                      {fmt(d.expected_after_plan)}
                    </td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-blue-300">
                      {d.cover_by_transfer > 0 ? fmt(d.cover_by_transfer) : '—'}
                    </td>
                    <td className="border border-gray-800 px-2 py-2 text-right text-red-300 font-semibold">
                      {d.cover_by_purchase > 0 ? fmt(d.cover_by_purchase) : '—'}
                    </td>
                    <td className="border border-gray-800 px-2 py-2 text-center whitespace-nowrap">
                      <span className={statusColor[d.status] || 'text-gray-400'}>
                        {statusIcon[d.status]} {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─── НИЖНЯЯ ПАНЕЛЬ ─── */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 flex flex-wrap gap-3 items-center">
          <span className="text-xs text-gray-400 font-semibold uppercase">⚙ Управление:</span>
          <button
            onClick={() => setShowSynonyms(!showSynonyms)}
            className="text-xs border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-800 transition"
          >
            🔗 База синонимов
          </button>
          <span className="text-xs text-gray-600">|</span>
          <span className="text-xs text-gray-500">
            В пути: {dashStatus?.active_inbound_count ?? '—'} •
            На проверке: {dashStatus?.unresolved_review_count ?? '—'}
          </span>
          <span className="ml-auto text-xs text-green-600">● Google Sheets</span>
        </div>

        {/* ─── ПАНЕЛЬ СИНОНИМОВ ─── */}
        {showSynonyms && (
          <SynonymsPanel rawMaterials={rawMaterials} onClose={() => setShowSynonyms(false)} onRefresh={load} />
        )}
      </div>
    </div>
  );
}

function UnmatchedRow({ item, rawMaterials, onConfirm }: {
  item: UnmatchedItem;
  rawMaterials: RawMaterial[];
  onConfirm: (item: UnmatchedItem, raw_uid: string) => void;
}) {
  const [selectedUid, setSelectedUid] = useState('');
  return (
    <div className="flex items-center gap-2 bg-gray-800 rounded px-3 py-2 text-xs">
      <span className="font-mono text-yellow-300 flex-1 truncate">{item.original_text}</span>
      <span className="text-gray-500 shrink-0">[{item.source_type}]</span>
      <select
        value={selectedUid}
        onChange={e => setSelectedUid(e.target.value)}
        className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-200 text-xs"
      >
        <option value="">Выберите сырьё...</option>
        {rawMaterials.map(rm => (
          <option key={rm.raw_uid} value={rm.raw_uid}>{rm.full_name}</option>
        ))}
      </select>
      <button
        disabled={!selectedUid}
        onClick={() => onConfirm(item, selectedUid)}
        className="bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded disabled:opacity-40 transition shrink-0"
      >
        ✓
      </button>
    </div>
  );
}

function SynonymsPanel({ rawMaterials, onClose, onRefresh }: {
  rawMaterials: RawMaterial[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [synonyms, setSynonyms] = useState<any[]>([]);
  const [form, setForm] = useState({ raw_uid: '', synonym: '' });

  useEffect(() => {
    axios.get('/api/synonyms').then(r => setSynonyms(r.data)).catch(() => {});
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await axios.post('/api/synonyms', { raw_uid: form.raw_uid, synonym: form.synonym });
    setForm({ raw_uid: '', synonym: '' });
    const r = await axios.get('/api/synonyms');
    setSynonyms(r.data);
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    await axios.delete(`/api/synonyms/${id}`);
    setSynonyms(synonyms.filter(s => s.id !== id));
  };

  return (
    <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">🔗 База синонимов (маппинг)</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">✕ Закрыть</button>
      </div>
      <form onSubmit={handleAdd} className="flex gap-2 mb-3">
        <select
          value={form.raw_uid}
          onChange={e => setForm({ ...form, raw_uid: e.target.value })}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 flex-1"
          required
        >
          <option value="">Выбрать сырьё...</option>
          {rawMaterials.map(rm => <option key={rm.raw_uid} value={rm.raw_uid}>{rm.full_name}</option>)}
        </select>
        <input
          value={form.synonym}
          onChange={e => setForm({ ...form, synonym: e.target.value })}
          placeholder="Синоним (из файла)"
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 flex-1"
          required
        />
        <button type="submit" className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded transition">
          + Добавить
        </button>
      </form>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {synonyms.map(s => (
          <div key={s.id} className="flex items-center gap-2 text-xs text-gray-300 bg-gray-800 rounded px-3 py-1.5">
            <span className="text-gray-500 w-28 truncate">{s.name}</span>
            <span className="text-gray-600">→</span>
            <span className="font-mono text-gray-200 flex-1">{s.synonym}</span>
            <span className="text-gray-600">[{s.source}]</span>
            <button onClick={() => handleDelete(s.id)} className="text-red-500 hover:text-red-400">✕</button>
          </div>
        ))}
        {synonyms.length === 0 && <p className="text-center text-gray-600 py-2">Синонимов нет</p>}
      </div>
    </section>
  );
}
