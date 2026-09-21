import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

interface ExpiryRow {
  id: number;
  sku_code: string;
  sku_name: string;
  batch_code: string | null;
  qty_kg: number;
  unit: string | null;
  manufacture_date: string | null;
  expiry_date: string | null;
  snapshot_date: string;
  vendor_name: string | null;
  source: string | null;
}

function calcStatus(expiryDate: string | null): { label: string; cls: string; days: number | null } {
  if (!expiryDate) return { label: 'Нет данных', cls: 'text-gray-500', days: null };
  const exp = new Date(expiryDate);
  if (isNaN(exp.getTime())) return { label: 'Некорректная дата', cls: 'text-gray-500', days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = exp.getTime() - today.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: 'Просрочено', cls: 'text-red-400 font-bold', days };
  if (days <= 29) return { label: `Срочно (${days} дн.)`, cls: 'text-red-400', days };
  if (days <= 90) return { label: `Внимание (${days} дн.)`, cls: 'text-yellow-400', days };
  return { label: `Норма (${days} дн.)`, cls: 'text-green-400', days };
}

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return 'Не указано';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 'Не указано' : d.toLocaleDateString('ru-RU');
};

const formatQty = (val: number | null | undefined): string => {
  return val != null && !isNaN(val) ? nf.format(val) : '0';
};

export default function ExpiryTab({ loading }: { loading: boolean }) {
  const [rows, setRows] = useState<ExpiryRow[]>([]);
  const [load, setLoad] = useState(true);
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editManufacture, setEditManufacture] = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoad(true);
    try {
      const res = await axios.get<ExpiryRow[]>(`${API}/expiry`);
      setRows(res.data ?? []);
    } catch (e: any) {
      setMsg(`❌ ${e.response?.data?.error || 'Ошибка загрузки'}`);
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const startEdit = (row: ExpiryRow) => {
    setEditingId(row.id);
    const toDateInput = (v: string | null | undefined) => {
      if (!v) return '';
      const d = new Date(v);
      return isNaN(d.getTime()) ? '' : v.length >= 10 ? v.slice(0, 10) : '';
    };
    setEditManufacture(toDateInput(row.manufacture_date));
    setEditExpiry(toDateInput(row.expiry_date));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditManufacture('');
    setEditExpiry('');
  };

  const saveEdit = async (id: number) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      body.manufacture_date = editManufacture || null;
      body.expiry_date = editExpiry || null;
      const res = await axios.put(`${API}/expiry/${id}`, body);
      if (res.data) {
        setRows(prev => prev.map(r => r.id === id ? { ...r, ...res.data } : r));
      }
      cancelEdit();
      setMsg('✅ Сохранено');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setMsg(`❌ ${e.response?.data?.error || 'Ошибка сохранения'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-gray-300">Сроки годности</h3>
        <span className="text-xs text-gray-500">{rows.length} партий</span>
        <button onClick={fetchData} disabled={load}
          className="text-xs border border-gray-700 text-gray-400 px-2 py-1 rounded hover:bg-gray-800 disabled:opacity-40">
          ↻
        </button>
      </div>

      {msg && <div className={`mb-3 text-sm ${msg.startsWith('❌') ? 'text-red-400' : 'text-green-400'}`}>{msg}</div>}

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-left">
              <th className="px-2 py-2 font-medium">Статус</th>
              <th className="px-2 py-2 font-medium">Наименование</th>
              <th className="px-2 py-2 font-medium">Код</th>
              <th className="px-2 py-2 font-medium">Партия</th>
              <th className="px-2 py-2 font-medium text-right">Кол-во</th>
              <th className="px-2 py-2 font-medium">Дата производства</th>
              <th className="px-2 py-2 font-medium">Срок годности</th>
              <th className="px-2 py-2 font-medium">Осталось</th>
              <th className="px-2 py-2 font-medium">Действие</th>
            </tr>
          </thead>
          <tbody>
            {load && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">Загрузка…</td></tr>
            )}
            {!load && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">Нет партий. Загрузите КД Липковской.</td></tr>
            )}
            {rows.map(row => {
              const st = calcStatus(row.expiry_date);
              const isEditing = editingId === row.id;
              return (
                <tr key={row.id} className="border-t border-gray-800 hover:bg-gray-900/50">
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] whitespace-nowrap ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-200 max-w-[180px] truncate">{row.sku_name}</td>
                  <td className="px-2 py-1.5 text-gray-400">{row.sku_code}</td>
                  <td className="px-2 py-1.5 text-gray-300 font-mono">{row.batch_code || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(row.qty_kg)} {row.unit || 'кг'}</td>
                  <td className="px-2 py-1.5">
                    {isEditing ? (
                      <input type="date" value={editManufacture}
                        onChange={e => setEditManufacture(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 w-32" />
                    ) : (
                      <span className="text-gray-400">{formatDate(row.manufacture_date)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {isEditing ? (
                      <input type="date" value={editExpiry}
                        onChange={e => setEditExpiry(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 w-32" />
                    ) : (
                      <span className="text-gray-400">{formatDate(row.expiry_date)}</span>
                    )}
                  </td>
                  <td className={`px-2 py-1.5 tabular-nums ${st.cls}`}>
                    {st.days !== null ? (st.days < 0 ? `${Math.abs(st.days)} дн. просроч.` : `${st.days} дн.`) : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <button onClick={() => saveEdit(row.id)} disabled={saving}
                          className="text-[10px] bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded disabled:opacity-40">
                          {saving ? '…' : 'Сохранить'}
                        </button>
                        <button onClick={cancelEdit}
                          className="text-[10px] text-gray-400 hover:text-white px-1">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(row)}
                        className="text-[10px] text-blue-400 hover:text-blue-300">
                        ✏ Ввести
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
