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

type DocType = 'polotsk' | 'lipkovskaya' | 'kd' | 'recipe';

interface DocumentMeta {
  id: number;
  docType: DocType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

type DocumentsMap = Record<DocType, { active: DocumentMeta | null; archive: DocumentMeta[] }>;

/** Человекочитаемые названия типов документов для страницы архива. */
const DOC_TITLES: Record<DocType, string> = {
  polotsk: 'Полоцк КХП (Остатки)',
  lipkovskaya: 'Липковская (ЗПП-37)',
  kd: 'Липковская (КД по партиям)',
  recipe: 'Рецептура',
};

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

/** Таблица монитора закупок — переиспользуется в основном экране и на странице списка по статусу. */
function MonitorTable({ rows, loading, loadError }: { rows: Decision[]; loading: boolean; loadError: string }) {
  return (
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
          {rows.length === 0 && (
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
          {rows.map((d, idx) => (
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
  );
}

export default function Dashboard({ onOpenPlanning }: { onOpenPlanning?: () => void }) {
  const [decisions, setDecisions]       = useState<Decision[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [catalog, setCatalog]           = useState<RawMaterial[]>([]);
  const [inbound, setInbound]           = useState<InboundItem[]>([]);
  const [unmatched, setUnmatched]       = useState<UnmatchedItem[]>([]);
  const [dashStatus, setDashStatus]     = useState<DashStatus | null>(null);

  const [showNewPosForm, setShowNewPosForm] = useState(false);
  const [newPos, setNewPos]                 = useState({ uid: '', name: '', short_name: '', unit: 'кг' });
  const [newPosStatus, setNewPosStatus]     = useState('');
  const [uidEdited, setUidEdited]           = useState(false);
  const [showCatalogMgr, setShowCatalogMgr] = useState(false);
  const [catalogSearch, setCatalogSearch]   = useState('');

  // Следующий свободный код RAW_NNN по каталогу — для авто-присвоения.
  const nextRawCode = useCallback(() => {
    let max = 0;
    for (const m of catalog) {
      const match = /^RAW_?(\d+)$/i.exec(m.raw_uid ?? '');
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `RAW_${String(max + 1).padStart(3, '0')}`;
  }, [catalog]);

  // Пока код не правили вручную, держим его равным авто-сгенерированному.
  useEffect(() => {
    if (showNewPosForm && !uidEdited) {
      setNewPos(p => ({ ...p, uid: nextRawCode() }));
    }
  }, [showNewPosForm, uidEdited, nextRawCode]);

  const [detailStatus, setDetailStatus] = useState<string | null>(null);
  const [search, setSearch]             = useState('');
  const [loading, setLoading]           = useState(false);
  const [loadError, setLoadError]       = useState('');
  const [uploading, setUploading]       = useState(false);
  const [showLipForm, setShowLipForm]   = useState(false);

  const [polotskFile, setPolotskFile]     = useState<File | null>(null);
  const [lipFile, setLipFile]             = useState<File | null>(null);
  const [kdFile, setKdFile]               = useState<File | null>(null);
  const [recipeFile, setRecipeFile]       = useState<File | null>(null);
  const [polotskStatus, setPolotskStatus] = useState('');
  const [lipStatus, setLipStatus]         = useState('');
  const [kdStatus, setKdStatus]           = useState('');
  const [recipeStatus, setRecipeStatus]   = useState('');
  const [lipTab, setLipTab]               = useState<'zpp' | 'kd'>('kd');
  const [documents, setDocuments]         = useState<DocumentsMap | null>(null);
  const [openArchive, setOpenArchive]     = useState<DocType | null>(null);

  const [inboundForm, setInboundForm] = useState({ raw_uid: '', raw_name: '', qty: '', eta: '', destination: '', document: '' });
  const [lipForm, setLipForm]         = useState({ raw_uid: '', name: '', qty_on_hand: '', reserved_qty: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    // Разные домены отказа: основной экран (Postgres) и блок распознавания
    // (Google Sheets) грузим независимо — сбой Sheets не должен ломать дашборд.
    const [dashRes, unmatchedRes, catalogRes, docsRes] = await Promise.allSettled([
      axios.get(`${API}/dashboard/all`),
      axios.get(`${API}/upload/unmatched`),
      axios.get(`${API}/raw-materials`),
      axios.get(`${API}/documents`),
    ]);

    if (dashRes.status === 'fulfilled') {
      const { data } = dashRes.value;
      setDecisions(data.decisions ?? []);
      setRawMaterials(data.rawMaterials ?? []);
      setInbound(data.inbound ?? []);
      setDashStatus(data.status ?? null);
      setLoadError('');
    } else {
      const e: any = dashRes.reason;
      setLoadError(e?.response?.data?.error || e?.message || String(e));
      console.error('Dashboard load error:', e);
    }

    // Очередь распознавания и каталог берём из того же источника (Google Sheets),
    // куда пишет загрузка документов — иначе дашборд (Postgres) показывал 0.
    if (unmatchedRes.status === 'fulfilled') {
      setUnmatched(unmatchedRes.value.data ?? []);
    } else {
      console.error('Unmatched load error:', unmatchedRes.reason);
    }

    if (catalogRes.status === 'fulfilled') {
      setCatalog(
        (catalogRes.value.data ?? []).map((m: any) => ({
          raw_uid: m.uid,
          full_name: m.name,
          short_name: m.short_name,
          unit: m.unit,
          avg_monthly_usage: m.avg_monthly_consumption ?? 0,
          active: m.active,
        }))
      );
    } else {
      console.error('Catalog load error:', catalogRes.reason);
    }

    if (docsRes.status === 'fulfilled') {
      setDocuments(docsRes.value.data ?? null);
    } else {
      console.error('Documents load error:', docsRes.reason);
    }

    setLoading(false);
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

  const handleKdUpload = async () => {
    if (!kdFile) return;
    setUploading(true);
    setKdStatus('Разбор ведомости по партиям...');
    try {
      const fd = new FormData();
      fd.append('file', kdFile);
      const r = await axios.post(`${API}/upload/lipkovskaya-kd`, fd);
      setKdStatus(`✅ ${r.data.message}`);
      setKdFile(null);
      load();
    } catch (e: any) {
      setKdStatus(`❌ ${e.response?.data?.error || 'Ошибка загрузки'}`);
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
    if (!inboundForm.raw_uid) {
      alert('Сначала распознайте сырьё (кнопка ✨ ИИ) или введите точное название из каталога');
      return;
    }
    try {
      await axios.post(`${API}/in-transit`, {
        raw_uid: inboundForm.raw_uid,
        raw_name: inboundForm.raw_name || inboundForm.raw_uid,
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
    if (!lipForm.raw_uid) {
      alert('Сначала распознайте сырьё (кнопка ✨ ИИ) или введите точное название из каталога');
      return;
    }
    try {
      const total = parseFloat(lipForm.qty_on_hand);
      const reserved = parseFloat(lipForm.reserved_qty || '0');
      await axios.post(`${API}/inventory/lipkovskaya`, {
        raw_uid: lipForm.raw_uid,
        name_from_source: lipForm.name || lipForm.raw_uid,
        qty_on_hand: total,
        reserved_qty: reserved,
        free_qty: Math.max(0, total - reserved),
      });
      setLipForm({ raw_uid: '', name: '', qty_on_hand: '', reserved_qty: '' });
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
    // Привязываем синоним один раз, затем закрываем ВСЕ строки очереди с тем же
    // текстом (повторные загрузки одного файла создают дубли в ReviewQueue).
    const sameText = unmatched.filter(u => u.original_text === item.original_text);
    await axios.post(`${API}/upload/unmatched/confirm`, {
      queueId: item.id,
      raw_uid,
      synonym: item.original_text,
    });
    // Дубли закрываем «мягко»: сбой одной строки не должен ронять всю операцию.
    await Promise.allSettled(
      sameText
        .filter(u => u.id !== item.id)
        .map(u => axios.post(`${API}/upload/unmatched/confirm`, { queueId: u.id }))
    );
    load();
  };

  // Удаление строки из очереди распознавания без привязки к каталогу — для
  // позиций, которые не являются сырьём/кормовой добавкой (упаковка, услуги).
  const handleDiscardUnmatched = async (item: UnmatchedItem) => {
    if (!confirm(`Удалить «${item.original_text}» из распознавания? Это не сырьё — позиция больше не будет предлагаться при загрузках (видна на вкладке «Исключённые»).`)) return;
    // Глобальное постоянное исключение: запоминаем текст и закрываем все строки
    // очереди с тем же названием.
    await axios.post(`${API}/upload/unmatched/exclude`, { text: item.original_text });
    load();
  };

  // Удаление позиции из справочника (каталога Syryo).
  const handleDeleteCatalog = async (m: RawMaterial) => {
    if (!confirm(`Удалить позицию «${m.full_name}» (${m.raw_uid}) из справочника?`)) return;
    try {
      await axios.delete(`${API}/raw-materials/${encodeURIComponent(m.raw_uid)}`);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка удаления');
    }
  };

  const handleAddNewPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPos.uid.trim() || !newPos.name.trim()) {
      setNewPosStatus('❌ Укажите код и наименование');
      return;
    }
    setNewPosStatus('Сохранение...');
    try {
      await axios.post(`${API}/raw-materials`, {
        uid: newPos.uid.trim(),
        name: newPos.name.trim(),
        short_name: newPos.short_name.trim(),
        unit: newPos.unit.trim() || 'кг',
      });
      setNewPosStatus(`✅ Позиция «${newPos.name.trim()}» добавлена в каталог`);
      setNewPos({ uid: '', name: '', short_name: '', unit: 'кг' });
      setUidEdited(false);
      load();
    } catch (err: any) {
      setNewPosStatus(`❌ ${err.response?.data?.error || 'Ошибка сохранения'}`);
    }
  };

  const uniqueUnmatched = (() => {
    const seen = new Set<string>();
    return unmatched.filter(u => {
      if (seen.has(u.original_text)) return false;
      seen.add(u.original_text);
      return true;
    });
  })();

  const handleExport = () => { window.location.href = `${API}/dashboard/export`; };

  const fmtDate = (d: string | null) => d ? d : 'нет данных';

  /** ISO-время → «18.05.2026, 14:32» (локаль Москвы, одинаково для всех). */
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

  /** Человекочитаемый размер файла. */
  const fmtSize = (b: number) =>
    b < 1024 ? `${b} Б` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} КБ` : `${(b / 1024 / 1024).toFixed(1)} МБ`;

  /** Скачивание документа из архива. */
  const downloadDoc = (id: number) => { window.location.href = `${API}/documents/${id}/download`; };

  /** Удаление документа из архива (без восстановления). */
  const handleDeleteDoc = async (d: DocumentMeta, isActive: boolean) => {
    const warn = isActive
      ? ' Это действующая версия — после удаления действующей станет предыдущая.'
      : '';
    if (!confirm(`Удалить «${d.fileName}» из архива?${warn} Восстановить файл будет нельзя.`)) return;
    try {
      await axios.delete(`${API}/documents/${d.id}`);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка удаления');
    }
  };

  /**
   * Блок «действующий документ + архив» для секции загрузки. Показывает имя и
   * время закрепления (из БД, одинаковое для всех), кнопку разворота архива и
   * список всех версий со скачиванием.
   */
  const DocArchive = ({ docType, accent }: { docType: DocType; accent: string }) => {
    const bucket = documents?.[docType];
    const active = bucket?.active ?? null;
    const archive = bucket?.archive ?? [];
    return (
      <div className="mt-2 pt-2 border-t border-gray-700/60 text-xs">
        {active ? (
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => downloadDoc(active.id)}
              className={`truncate text-left ${accent} hover:underline`}
              title={`Скачать действующий документ: ${active.fileName}`}
            >
              ⬇ {active.fileName}
            </button>
            <button
              onClick={() => setOpenArchive(docType)}
              className="shrink-0 text-gray-400 hover:text-gray-200 border border-gray-600 rounded px-1.5 py-0.5"
            >
              🗂 Архив ({archive.length})
            </button>
          </div>
        ) : (
          <div className="text-gray-500">Документ ещё не закреплён</div>
        )}
        {active && (
          <div className="text-gray-400 mt-1">
            Закреплён: {fmtDateTime(active.uploadedAt)} · {fmtSize(active.sizeBytes)}
          </div>
        )}
      </div>
    );
  };

  const counts = {
    urgent: decisions.filter(d => d.status === 'Срочно к закупке').length,
    buy: decisions.filter(d => d.status === 'К закупке').length,
    watch: decisions.filter(d => d.status === 'На контроле').length,
    ok: decisions.filter(d => d.status === 'Норма').length,
  };

  // ─── ОТДЕЛЬНАЯ СТРАНИЦА СПИСКА ПО СТАТУСУ ───
  if (detailStatus) {
    const detailRows = decisions.filter(d => {
      if (d.status !== detailStatus) return false;
      if (search && !d.name.toLowerCase().includes(search.toLowerCase()) &&
          !d.raw_uid.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
        <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setDetailStatus(null); setSearch(''); }}
              className="text-xs border border-gray-700 text-gray-300 px-3 py-1 rounded hover:bg-gray-800 transition"
            >
              ← В основное меню
            </button>
            <span className="text-lg font-bold text-white">
              {statusIcon[detailStatus]} {detailStatus}
            </span>
            <span className="text-xs text-gray-500 border border-gray-700 rounded px-2 py-0.5">
              {detailRows.length} позиций
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            {loading && <span className="text-xs text-blue-400 animate-pulse">загрузка...</span>}
            <input
              type="text" placeholder="Поиск сырья..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 w-40"
            />
            <button
              onClick={handleExport}
              className="text-xs border border-blue-700 text-blue-400 px-3 py-1 rounded hover:bg-blue-900/30 transition"
            >
              ⬇ Excel
            </button>
          </div>
        </header>
        <div className="p-4 max-w-screen-2xl mx-auto">
          <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
            <MonitorTable rows={detailRows} loading={loading} loadError={loadError} />
          </section>
        </div>
      </div>
    );
  }

  // ─── ОТДЕЛЬНАЯ СТРАНИЦА АРХИВА ДОКУМЕНТОВ ───
  if (openArchive) {
    const bucket = documents?.[openArchive];
    const archive = bucket?.archive ?? [];
    const activeId = bucket?.active?.id ?? null;
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
        <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpenArchive(null)}
              className="text-xs border border-gray-700 text-gray-300 px-3 py-1 rounded hover:bg-gray-800 transition"
            >
              ← В основное меню
            </button>
            <span className="text-lg font-bold text-white">
              🗂 Архив: {DOC_TITLES[openArchive]}
            </span>
            <span className="text-xs text-gray-500 border border-gray-700 rounded px-2 py-0.5">
              {archive.length} версий
            </span>
          </div>
        </header>
        <div className="p-4 max-w-screen-2xl mx-auto">
          <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
            {archive.length === 0 ? (
              <div className="text-sm text-gray-500">В архиве пока нет документов.</div>
            ) : (
              <div className="space-y-2">
                {archive.map(d => {
                  const isActive = d.id === activeId;
                  return (
                    <div
                      key={d.id}
                      className={`flex items-center justify-between gap-3 rounded px-3 py-2 border ${
                        isActive ? 'border-green-700 bg-green-950/20' : 'border-gray-700 bg-gray-800/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <button
                          onClick={() => downloadDoc(d.id)}
                          className="truncate text-left text-sm text-blue-400 hover:underline block max-w-full"
                          title={`Скачать: ${d.fileName}`}
                        >
                          ⬇ {d.fileName}
                        </button>
                        <div className="text-xs text-gray-400 mt-0.5">
                          Закреплён: {fmtDateTime(d.uploadedAt)} · {fmtSize(d.sizeBytes)}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {isActive && (
                          <span className="text-xs text-green-400 border border-green-700 rounded px-2 py-0.5">
                            ● Действующий
                          </span>
                        )}
                        <button
                          onClick={() => handleDeleteDoc(d, isActive)}
                          className="text-xs text-red-400 border border-red-800 rounded px-2 py-0.5 hover:bg-red-950/40 transition"
                          title="Удалить из архива"
                        >
                          🗑 Удалить
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

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
              onClick={() => { setDetailStatus(s.label); setSearch(''); }}
              className={`border rounded-lg p-3 text-left transition hover:opacity-90 ${s.color}`}
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
              <DocArchive docType="polotsk" accent="text-green-400" />
            </div>

            {/* Липковская — вкладки ЗПП-37 / КД */}
            <div className="border border-yellow-700 rounded-lg p-4 bg-gray-800/50">
              <div className="font-semibold text-white text-sm mb-2">🏛 Липковская (Минск)</div>
              {/* Tab switcher */}
              <div className="flex gap-1 mb-3">
                <button
                  onClick={() => setLipTab('kd')}
                  className={`flex-1 text-xs py-1 rounded transition border ${lipTab === 'kd' ? 'bg-yellow-700/40 border-yellow-500 text-yellow-300' : 'border-gray-600 text-gray-500 hover:text-gray-300'}`}
                >
                  КД (по партиям)
                </button>
                <button
                  onClick={() => setLipTab('zpp')}
                  className={`flex-1 text-xs py-1 rounded transition border ${lipTab === 'zpp' ? 'bg-yellow-700/40 border-yellow-500 text-yellow-300' : 'border-gray-600 text-gray-500 hover:text-gray-300'}`}
                >
                  ЗПП-37
                </button>
              </div>

              {lipTab === 'kd' && (
                <>
                  {kdStatus && (
                    <div className={`text-xs mb-2 ${kdStatus.startsWith('✅') ? 'text-green-300' : 'text-red-300'}`}>{kdStatus}</div>
                  )}
                  <div className="text-xs text-gray-500 mb-2">Ведомость по партиям товаров (1С)</div>
                  <input
                    type="file" accept=".xlsx,.xls"
                    onChange={e => { setKdFile(e.target.files?.[0] || null); setKdStatus(''); }}
                    className="text-xs text-gray-300 mb-2 w-full"
                  />
                  {kdFile && <p className="text-xs text-gray-400 mb-2 truncate">{kdFile.name}</p>}
                  <button
                    onClick={handleKdUpload}
                    disabled={!kdFile || uploading}
                    className="w-full border border-yellow-600 text-yellow-400 text-sm py-1.5 rounded hover:bg-yellow-500/10 disabled:opacity-40 transition"
                  >
                    {uploading && kdFile ? 'Обработка...' : 'Загрузить КД'}
                  </button>
                  <DocArchive docType="kd" accent="text-yellow-400" />
                </>
              )}

              {lipTab === 'zpp' && (
                <>
                  {lipStatus && (
                    <div className={`text-xs mb-2 ${lipStatus.startsWith('✅') ? 'text-green-300' : 'text-red-300'}`}>{lipStatus}</div>
                  )}
                  <div className="text-xs text-gray-500 mb-2">Складской отчёт ЗПП-37</div>
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
                  <DocArchive docType="lipkovskaya" accent="text-yellow-400" />
                </>
              )}
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
              <DocArchive docType="recipe" accent="text-blue-400" />
            </div>
          </div>

          {/* Форма ввода остатков Липковской */}
          {showLipForm && (
            <form onSubmit={handleAddLipStock} className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 bg-gray-800 rounded-lg p-3">
              <div className="col-span-2">
                <MaterialPicker
                  rawMaterials={rawMaterials}
                  value={lipForm.name}
                  onResolve={(name, raw_uid) => setLipForm({ ...lipForm, name, raw_uid })}
                />
              </div>
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

        {/* ─── РАСПОЗНАВАНИЕ НЕРАСПОЗНАННЫХ СТРОК (ИИ + ручной ввод) ─── */}
        <section className={`border rounded-lg p-4 ${unmatched.length > 0 ? 'bg-yellow-950/40 border-yellow-700' : 'bg-gray-900 border-gray-700'}`}>
          <h2 className={`text-xs font-semibold uppercase tracking-wider mb-1 ${unmatched.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
            {uniqueUnmatched.length > 0
              ? `⚠ Распознавание — ${uniqueUnmatched.length} позиций не привязано к каталогу${unmatched.length !== uniqueUnmatched.length ? ` (${unmatched.length} строк с учётом повторов)` : ''}`
              : '✅ Распознавание — всё распознано'}
          </h2>
          {uniqueUnmatched.length > 0 ? (
            <>
              <p className="text-xs text-gray-400 mb-3">
                Нажмите «✨ ИИ» для авто-подсказки или выберите позицию из каталога вручную, затем «✓».
                Если позиции нет в каталоге — добавьте её ниже через «+ Новая позиция каталога».
              </p>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {uniqueUnmatched.map(item => (
                  <UnmatchedRow
                    key={item.id}
                    item={item}
                    rawMaterials={catalog}
                    onConfirm={handleConfirmUnmatched}
                    onDiscard={handleDiscardUnmatched}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-500">
              Нераспознанных строк нет — все позиции из загруженных файлов привязаны к каталогу.
            </p>
          )}

          {/* ─── Ввод новой позиции каталога ─── */}
          <div className="mt-3 pt-3 border-t border-gray-700">
            <button
              onClick={() => { setShowNewPosForm(!showNewPosForm); setNewPosStatus(''); }}
              className="text-xs border border-green-700 text-green-300 px-3 py-1.5 rounded hover:bg-green-900/30 transition"
            >
              {showNewPosForm ? '▲ Скрыть форму' : '+ Новая позиция каталога'}
            </button>
            {showNewPosForm && (
              <form onSubmit={handleAddNewPosition} className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 bg-gray-800 rounded-lg p-3">
                <div className="flex flex-col">
                  <input
                    type="text" placeholder="Код (напр. RAW_069)"
                    value={newPos.uid}
                    onChange={e => { setUidEdited(true); setNewPos({ ...newPos, uid: e.target.value }); }}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
                    required
                  />
                  <span className="text-[10px] text-gray-500 mt-0.5">
                    {uidEdited ? 'код задан вручную' : 'код присвоен автоматически — можно изменить'}
                  </span>
                </div>
                <input
                  type="text" placeholder="Полное наименование"
                  value={newPos.name}
                  onChange={e => setNewPos({ ...newPos, name: e.target.value })}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 col-span-2"
                  required
                />
                <input
                  type="text" placeholder="Краткое имя (необяз.)"
                  value={newPos.short_name}
                  onChange={e => setNewPos({ ...newPos, short_name: e.target.value })}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
                />
                <input
                  type="text" placeholder="Ед. (кг)"
                  value={newPos.unit}
                  onChange={e => setNewPos({ ...newPos, unit: e.target.value })}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
                />
                <button
                  type="submit"
                  className="col-span-2 md:col-span-5 bg-green-700 hover:bg-green-600 text-white text-sm py-1.5 rounded transition"
                >
                  Добавить позицию в каталог
                </button>
                {newPosStatus && (
                  <div className={`col-span-2 md:col-span-5 text-xs ${newPosStatus.startsWith('✅') ? 'text-green-300' : newPosStatus.startsWith('❌') ? 'text-red-300' : 'text-gray-400'}`}>
                    {newPosStatus}
                  </div>
                )}
              </form>
            )}
          </div>

          {/* ─── Управление справочником (удаление позиций) ─── */}
          <div className="mt-2">
            <button
              onClick={() => { setShowCatalogMgr(!showCatalogMgr); setCatalogSearch(''); }}
              className="text-xs border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-800 transition"
            >
              {showCatalogMgr ? '▲ Скрыть справочник' : `⚙ Справочник (${catalog.length})`}
            </button>
            {onOpenPlanning && (
              <button
                onClick={onOpenPlanning}
                className="ml-2 text-xs border border-emerald-700 text-emerald-300 px-3 py-1.5 rounded hover:bg-emerald-900/30 transition"
              >
                📋 Планирование закупок
              </button>
            )}
            {showCatalogMgr && (
              <div className="mt-3 bg-gray-800 rounded-lg p-3">
                <input
                  type="text" placeholder="Поиск по названию или коду..."
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 mb-2"
                />
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {catalog
                    .filter(m => {
                      const q = catalogSearch.trim().toLowerCase();
                      if (!q) return true;
                      return m.full_name.toLowerCase().includes(q) || m.raw_uid.toLowerCase().includes(q);
                    })
                    .map(m => (
                      <div key={m.raw_uid} className="flex items-center gap-2 text-xs bg-gray-900 rounded px-2 py-1.5">
                        <span className="font-mono text-gray-500 w-20 shrink-0">{m.raw_uid}</span>
                        <span className="text-gray-200 flex-1 truncate" title={m.full_name}>{m.full_name}</span>
                        <button
                          onClick={() => handleDeleteCatalog(m)}
                          title="Удалить позицию из справочника"
                          className="bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white px-2 py-1 rounded transition shrink-0"
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                  {catalog.length === 0 && (
                    <p className="text-xs text-gray-500">Справочник пуст.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ─── СЫРЬЁ В ПУТИ ─── */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h2 className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">
            🚛 Сырьё в пути ({inbound.length}) — ручной ввод
          </h2>
          <form onSubmit={handleAddInbound} className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
            <div className="col-span-2 md:col-span-2">
              <MaterialPicker
                rawMaterials={rawMaterials}
                value={inboundForm.raw_name}
                onResolve={(name, raw_uid) => setInboundForm({ ...inboundForm, raw_name: name, raw_uid })}
              />
            </div>
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

        {/* ─── НИЖНЯЯ ПАНЕЛЬ ─── */}
        <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 flex flex-wrap gap-3 items-center">
          <span className="text-xs text-gray-500">
            В пути: {dashStatus?.active_inbound_count ?? '—'} •
            На проверке: {dashStatus?.unresolved_review_count ?? '—'}
          </span>
          <span className="ml-auto text-xs text-green-600">● Google Sheets</span>
        </div>
      </div>
    </div>
  );
}

interface AiHint {
  suggested_raw_uid: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Свободный ввод названия сырья с распознаванием.
 * Сначала пытается мгновенно сопоставить локально (точное/частичное совпадение
 * по каталогу), иначе — по кнопке «✨ ИИ» вызывает ai-suggest. Резолв возвращается
 * родителю через onResolve(name, raw_uid). raw_uid='' означает «не распознано».
 */
function MaterialPicker({ rawMaterials, value, onResolve }: {
  rawMaterials: RawMaterial[];
  value: string;
  onResolve: (name: string, raw_uid: string) => void;
}) {
  const [aiLoading, setAiLoading] = useState(false);
  const [status, setStatus] = useState<{ uid: string; label: string; conf: string } | null>(null);

  // Сброс индикатора при очистке поля родителем (после submit).
  useEffect(() => {
    if (!value.trim()) setStatus(null);
  }, [value]);

  // Только ТОЧНОЕ совпадение по каталогу авто-резолвится локально, чтобы
  // не привязать молча неверное сырьё при неоднозначном вводе. Для остальных
  // случаев — кнопка «✨ ИИ».
  const matchLocal = (n: string): RawMaterial | null => {
    const q = n.trim().toLowerCase();
    if (q.length < 3) return null;
    return rawMaterials.find(m =>
      m.full_name.toLowerCase() === q || m.short_name.toLowerCase() === q
    ) || null;
  };

  const handleText = (n: string) => {
    const local = matchLocal(n);
    if (local) {
      setStatus({ uid: local.raw_uid, label: local.full_name, conf: 'каталог' });
      onResolve(n, local.raw_uid);
    } else {
      setStatus(null);
      onResolve(n, '');
    }
  };

  const handleAi = async () => {
    if (!value.trim()) return;
    setAiLoading(true);
    try {
      const { data } = await axios.post(`${API}/synonyms/ai-suggest`, { items: [value.trim()] });
      const s = Array.isArray(data) ? data[0] : null;
      if (s && s.suggested_raw_uid) {
        const m = rawMaterials.find(r => r.raw_uid === s.suggested_raw_uid);
        setStatus({ uid: s.suggested_raw_uid, label: m?.full_name || s.suggested_raw_uid, conf: s.confidence });
        onResolve(value, s.suggested_raw_uid);
      } else {
        setStatus({ uid: '', label: 'ИИ не распознал — уточните название', conf: 'нет' });
        onResolve(value, '');
      }
    } catch {
      setStatus({ uid: '', label: 'ошибка распознавания', conf: 'нет' });
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div>
      <div className="flex gap-1">
        <input
          type="text"
          placeholder="Название сырья (свободный ввод)..."
          value={value}
          onChange={e => handleText(e.target.value)}
          className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200"
        />
        <button
          type="button"
          onClick={handleAi}
          disabled={aiLoading || !value.trim()}
          title="Распознать с помощью ИИ"
          className="border border-purple-600 text-purple-300 text-xs px-2 rounded hover:bg-purple-900/30 disabled:opacity-40 transition whitespace-nowrap"
        >
          {aiLoading ? '...' : '✨ ИИ'}
        </button>
      </div>
      {status && (
        <div className={`text-xs mt-1 ${status.uid ? 'text-green-400' : 'text-red-400'}`}>
          {status.uid ? `→ ${status.label} (${status.conf})` : status.label}
        </div>
      )}
    </div>
  );
}

function UnmatchedRow({ item, rawMaterials, onConfirm, onDiscard }: {
  item: UnmatchedItem;
  rawMaterials: RawMaterial[];
  onConfirm: (item: UnmatchedItem, raw_uid: string) => void;
  onDiscard: (item: UnmatchedItem) => void;
}) {
  const [selectedUid, setSelectedUid] = useState('');
  const [aiHint, setAiHint] = useState<AiHint | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleAiSuggest = async () => {
    setAiLoading(true);
    try {
      const { data } = await axios.post('/api/synonyms/ai-suggest', { items: [item.original_text] });
      const suggestion = Array.isArray(data) ? data[0] : null;
      if (suggestion) {
        setAiHint(suggestion);
        if (suggestion.suggested_raw_uid) {
          setSelectedUid(suggestion.suggested_raw_uid);
        }
      } else {
        setAiHint({ suggested_raw_uid: null, confidence: 'low', reason: 'ИИ не дал ответа — выберите вручную' });
      }
    } catch {
      setAiHint({ suggested_raw_uid: null, confidence: 'low', reason: 'ошибка обращения к ИИ — попробуйте ещё раз' });
    } finally {
      setAiLoading(false);
    }
  };

  const confidenceColor = aiHint?.confidence === 'high'
    ? 'text-green-400' : aiHint?.confidence === 'medium'
    ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="bg-gray-800 rounded px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-yellow-300 flex-1 truncate" title={item.original_text}>{item.original_text}</span>
        <span className="text-gray-500 shrink-0">[{item.source_type}]</span>
        <button
          onClick={handleAiSuggest}
          disabled={aiLoading}
          title="Спросить ИИ"
          className="bg-purple-700 hover:bg-purple-600 text-white px-2 py-1 rounded disabled:opacity-40 transition shrink-0 text-xs"
        >
          {aiLoading ? '...' : '✨ ИИ'}
        </button>
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
        <button
          onClick={() => onDiscard(item)}
          title="Не сырьё — удалить из распознавания"
          className="bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white px-2 py-1 rounded transition shrink-0"
        >
          🗑
        </button>
      </div>
      {aiHint && (
        <div className={`text-xs pl-1 ${confidenceColor}`}>
          ✨ {aiHint.suggested_raw_uid
            ? `${rawMaterials.find(m => m.raw_uid === aiHint.suggested_raw_uid)?.full_name ?? aiHint.suggested_raw_uid} — ${aiHint.reason}`
            : `Нет совпадения — ${aiHint.reason}`}
        </div>
      )}
    </div>
  );
}


