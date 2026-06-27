import { useState } from 'react';
import axios from 'axios';
import { Snapshot, fmt, SHEET_LABEL } from './types';

const API = '/api';

export default function SnapshotsTab({
  snapshots, loading, busy, setBusy, flash, reload,
}: {
  snapshots: Snapshot[];
  loading: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (m: string) => void;
  reload: () => Promise<void>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [kdFile, setKdFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const allSelected = snapshots.length > 0 && snapshots.every(s => sel.has(`${s.sheet}|${s.date}`));
  const toggleAll = () => {
    setSel(allSelected ? new Set() : new Set(snapshots.map(s => `${s.sheet}|${s.date}`)));
  };
  const toggle = (key: string) => {
    const next = new Set(sel);
    next.has(key) ? next.delete(key) : next.add(key);
    setSel(next);
  };

  const bulkDelete = async () => {
    if (!sel.size) return;
    if (!confirm(`Удалить выбранные снимки остатков (${sel.size})? Действие необратимо.`)) return;
    setBusy(true);
    try {
      const items = [...sel].map(k => {
        const [sheet, date] = k.split('|');
        return { sheet, date };
      });
      const r = await axios.post(`${API}/stock/snapshots/delete`, { items });
      flash(`✅ Удалено строк: ${r.data.removed}`);
      setSel(new Set());
      await reload();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleKdUpload = async () => {
    if (!kdFile) return;
    setBusy(true);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", kdFile);
      const r = await axios.post(`${API}/upload/lipkovskaya-kd`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      flash(`✅ ${r.data.message}`);
      setKdFile(null);
      await reload();
    } catch (e: any) {
      flash(`❌ ${e.response?.data?.error || 'Ошибка загрузки'}`);
    } finally {
      setBusy(false);
      setUploading(false);
    }
  };

  return (
    <section>
      {/* Блок загрузки */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold text-white mb-2">📥 Загрузить ведомость по партиям (КД)</h3>
        <p className="text-xs text-gray-500 mb-3">
          Файл из 1С: «Ведомость по партиям товаров на складах». Автоматически распознаёт
          наименования, партии и остатки. Не-сырьё отсеивается автоматически.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={e => setKdFile(e.target.files?.[0] || null)}
              className="text-xs text-gray-300 w-full"
            />
            {kdFile && (
              <p className="text-xs text-gray-400 mt-1 truncate">{kdFile.name}</p>
            )}
          </div>
          <button
            onClick={handleKdUpload}
            disabled={!kdFile || busy}
            className="bg-yellow-700 hover:bg-yellow-600 text-white text-sm px-4 py-1.5 rounded disabled:opacity-40 transition whitespace-nowrap"
          >
            {uploading ? 'Обработка...' : 'Загрузить КД'}
          </button>
        </div>
      </div>

      {/* Список снимков */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 max-w-2xl">
          Загруженные снимки остатков. Удаление убирает все строки из остатков.
        </p>
        <button onClick={bulkDelete} disabled={!sel.size || busy}
          className="text-xs border border-red-600 text-red-300 px-2 py-1 rounded hover:bg-red-500/10 disabled:opacity-30 whitespace-nowrap ml-3">
          Удалить выбранные ({sel.size})
        </button>
      </div>
      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Выбрать все" />
              </th>
              <th className="text-left px-3 py-2">Склад</th>
              <th className="text-left px-3 py-2">Дата</th>
              <th className="text-right px-3 py-2">Строк</th>
              <th className="text-right px-3 py-2">Количество</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map(s => {
              const key = `${s.sheet}|${s.date}`;
              return (
                <tr key={key} className="border-t border-gray-800">
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={sel.has(key)} onChange={() => toggle(key)} />
                  </td>
                  <td className="px-3 py-1.5">{SHEET_LABEL[s.sheet] || s.sheet}</td>
                  <td className="px-3 py-1.5 text-gray-300">{s.date}</td>
                  <td className="px-3 py-1.5 text-right text-gray-400">{s.rows}</td>
                  <td className="px-3 py-1.5 text-right text-gray-300">{fmt(s.qty)}</td>
                </tr>
              );
            })}
            {!snapshots.length && !loading && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">Нет загруженных снимков</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
