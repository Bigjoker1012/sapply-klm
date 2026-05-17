import React, { useState, useMemo } from 'react';

// Описание структуры данных
interface InventoryItem {
  id: string;
  name: string;
  polotsk: number;
  lipki: number;
  inTransit: number;
  free: number;
  status: 'СРОЧНО ЗАКУПАТЬ' | 'ПЕРЕВЕЗТИ С ЛИП' | 'ЗАПАС В НОРМЕ' | 'НА КОНТРОЛЕ';
}

interface TransitItem {
  id: string;
  name: string;
  amount: number;
  date: string;
}

export default function App() {
  // Поиск и фильтрация таблицы
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'CRITICAL' | 'TRANSFER'>('ALL');

  // Исходные данные таблицы (в точности как на макете!)
  const [inventory, setInventory] = useState<InventoryItem[]>([
    { id: 'RAW_001', name: 'Витамин А 1000', polotsk: 111.6, lipki: 0, inTransit: 500, free: -45.3, status: 'СРОЧНО ЗАКУПАТЬ' },
    { id: 'RAW_002', name: 'Витамин Д3 500', polotsk: 46.8, lipki: 200, inTransit: 0, free: 120.5, status: 'ПЕРЕВЕЗТИ С ЛИП' },
    { id: 'RAW_003', name: 'Мел', polotsk: 14500, lipki: 30000, inTransit: 10000, free: 32400, status: 'ЗАПАС В НОРМЕ' },
    { id: 'RAW_004', name: 'Сода (E500)', polotsk: 349.5, lipki: 0, inTransit: 0, free: 12.0, status: 'НА КОНТРОЛЕ' },
  ]);

  // Данные по сырью в пути
  const [transits, setTransits] = useState<TransitItem[]>([
    { id: '1', name: 'Витамин А 1000', amount: 500, date: '20.05.2026' }
  ]);

  // Состояния формы транзита
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [transitAmount, setTransitAmount] = useState('');
  const [transitDate, setTransitDate] = useState('');

  // Обработчик добавления транзита
  const handleAddTransit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial || !transitAmount || !transitDate) return;

    const newTransit: TransitItem = {
      id: Date.now().toString(),
      name: selectedMaterial,
      amount: Number(transitAmount),
      date: formatDate(transitDate),
    };

    setTransits([...transits, newTransit]);

    setInventory(prev => prev.map(item => {
      if (item.name === selectedMaterial) {
        const newTransitSum = item.inTransit + Number(transitAmount);
        return {
          ...item,
          inTransit: newTransitSum,
          free: item.polotsk + item.lipki + newTransitSum
        };
      }
      return item;
    }));

    setTransitAmount('');
    setTransitDate('');
  };

  // Удаление поставки
  const handleDeleteTransit = (id: string, name: string, amount: number) => {
    setTransits(transits.filter(t => t.id !== id));
    setInventory(prev => prev.map(item => {
      if (item.name === name) {
        const newTransitSum = Math.max(0, item.inTransit - amount);
        return {
          ...item,
          inTransit: newTransitSum,
          free: item.polotsk + item.lipki + newTransitSum
        };
      }
      return item;
    }));
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  };

  const filteredInventory = useMemo(() => {
    return inventory.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            item.id.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (activeFilter === 'CRITICAL') {
        return matchesSearch && item.status === 'СРОЧНО ЗАКУПАТЬ';
      }
      if (activeFilter === 'TRANSFER') {
        return matchesSearch && item.status === 'ПЕРЕВЕЗТИ С ЛИП';
      }
      return matchesSearch;
    });
  }, [inventory, searchQuery, activeFilter]);

  return (
    <div className="erp-app">
      {/* Встроенные стили для идеальной пиксель-в-пиксель точности без зависимостей */}
      <style>{`
        .erp-app {
          background-color: #0b0f19;
          color: #f1f5f9;
          font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
          padding: 1.5rem;
          min-h: 100vh;
          box-sizing: border-box;
        }
        .erp-app * {
          box-sizing: border-box;
        }
        
        /* HEADER */
        .erp-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #151f32;
          border: 1px solid #1e293b;
          border-radius: 0.75rem;
          padding: 1rem 1.5rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .header-title-wrapper {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .header-logo {
          font-size: 1.5rem;
        }
        .header-title {
          font-size: 1.25rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 0;
        }
        .accent-green {
          color: #10b981;
        }
        .header-meta {
          display: flex;
          gap: 1.5rem;
          font-size: 0.875rem;
          color: #94a3b8;
        }
        .meta-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .meta-badge {
          background-color: #1e293b;
          color: #e2e8f0;
          padding: 0.25rem 0.625rem;
          border-radius: 0.375rem;
          font-family: monospace;
          font-size: 0.75rem;
        }

        /* SECTION TILES */
        .section-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #94a3b8;
          margin-bottom: 0.75rem;
        }
        .section-header span {
          color: #64748b;
        }

        /* CARD GRID & CARDS */
        .cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
        }
        .card {
          background-color: #111a2e;
          border-radius: 0.75rem;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          min-height: 200px;
        }
        .card-polotsk { border: 1px solid rgba(16, 185, 129, 0.2); }
        .card-polotsk:hover { border-color: rgba(16, 185, 129, 0.5); }
        .card-minsk { border: 1px solid rgba(245, 158, 11, 0.2); }
        .card-minsk:hover { border-color: rgba(245, 158, 11, 0.5); }
        .card-recipe { border: 1px solid rgba(14, 165, 233, 0.2); }
        .card-recipe:hover { border-color: rgba(14, 165, 233, 0.5); }

        .card-top {
          margin-bottom: 1rem;
        }
        .card-header-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }
        .card-title-group {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .card-title-group span {
          font-size: 1.25rem;
        }
        .card-title {
          font-weight: 700;
          font-size: 0.95rem;
          color: #f1f5f9;
          margin: 0;
        }
        .format-badge {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-family: monospace;
        }
        .badge-green { background-color: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); }
        .badge-amber { background-color: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.2); }
        .badge-sky { background-color: rgba(14, 165, 233, 0.1); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.2); }

        .filename-box {
          font-size: 0.75rem;
          color: #94a3b8;
          background-color: rgba(15, 23, 42, 0.6);
          padding: 0.5rem;
          border-radius: 0.375rem;
          border: 1px solid #1e293b;
          margin-bottom: 0.75rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: #cbd5e1;
        }
        .dot {
          height: 0.5rem;
          width: 0.5rem;
          border-radius: 50%;
          display: inline-block;
        }
        .dot-green { background-color: #10b981; box-shadow: 0 0 8px #10b981; }
        .dot-amber { background-color: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
        .dot-sky { background-color: #0ea5e9; }

        /* BUTTONS */
        .btn {
          width: 100%;
          border: none;
          border-radius: 0.5rem;
          padding: 0.625rem 1rem;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-card-green {
          background-color: rgba(16, 185, 129, 0.1);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .btn-card-green:hover {
          background-color: #10b981;
          color: #ffffff;
          border-color: #10b981;
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
        }
        .btn-card-amber {
          background-color: rgba(245, 158, 11, 0.1);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .btn-card-amber:hover {
          background-color: #f59e0b;
          color: #ffffff;
          border-color: #f59e0b;
          box-shadow: 0 0 12px rgba(245, 158, 11, 0.4);
        }
        .btn-card-sky {
          background-color: rgba(14, 165, 233, 0.1);
          color: #38bdf8;
          border: 1px solid rgba(14, 165, 233, 0.3);
        }
        .btn-card-sky:hover {
          background-color: #0ea5e9;
          color: #ffffff;
          border-color: #0ea5e9;
          box-shadow: 0 0 12px rgba(14, 165, 233, 0.4);
        }

        /* IN TRANSIT SECTION */
        .transit-section {
          background-color: #111a2e;
          border: 1px solid #1e293b;
          border-radius: 0.75rem;
          padding: 1.25rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .transit-form {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem;
          align-items: flex-end;
          margin-bottom: 1rem;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .form-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #94a3b8;
        }
        .input-dark {
          background-color: #18233a;
          border: 1px solid #334155;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          color: #f1f5f9;
          font-size: 0.875rem;
          width: 100%;
          outline: none;
          transition: border-color 0.2s;
        }
        .input-dark:focus {
          border-color: #64748b;
        }
        .btn-submit {
          background-color: #1e293b;
          color: #f1f5f9;
          border: 1px solid #334155;
          padding: 0.55rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.825rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-submit:hover {
          background-color: #334155;
          border-color: #475569;
        }
        .transit-display-box {
          background-color: #0b101c;
          border: 1px solid #1e293b;
          border-radius: 0.5rem;
          padding: 0.75rem;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
        }
        .transit-title {
          color: #fbbf24;
          font-weight: 700;
          margin-right: 0.25rem;
        }
        .transit-tag {
          background-color: #162137;
          border: 1px solid rgba(255, 255, 255, 0.05);
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .btn-delete-tag {
          background: none;
          border: none;
          color: #ef4444;
          cursor: pointer;
          font-weight: 700;
          padding: 0;
          font-size: 0.75rem;
        }
        .btn-delete-tag:hover {
          color: #f87171;
        }

        /* MONITOR SECTION */
        .monitor-section {
          background-color: #111a2e;
          border: 1px solid #1e293b;
          border-radius: 0.75rem;
          padding: 1.25rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .monitor-bar {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #1e293b;
        }
        @media (min-width: 1024px) {
          .monitor-bar {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
        }
        .filter-group {
          background-color: #0b101c;
          border: 1px solid #1e293b;
          border-radius: 0.5rem;
          padding: 0.25rem;
          display: flex;
          gap: 0.25rem;
        }
        .btn-filter {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.375rem 0.75rem;
          border-radius: 0.375rem;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .btn-filter:hover {
          color: #f1f5f9;
        }
        .btn-filter.active-all {
          background-color: #1e293b;
          color: #ffffff;
          border: 1px solid #334155;
        }
        .btn-filter.active-critical {
          background-color: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .btn-filter.active-transfer {
          background-color: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .filter-dot {
          height: 0.375rem;
          width: 0.375rem;
          border-radius: 50%;
        }
        .filter-dot-red { background-color: #ef4444; }
        .filter-dot-amber { background-color: #f59e0b; }

        .search-wrapper {
          position: relative;
        }
        .search-input {
          background-color: #18233a;
          border: 1px solid #334155;
          border-radius: 0.5rem;
          padding: 0.45rem 0.75rem 0.45rem 2rem;
          color: #f1f5f9;
          font-size: 0.75rem;
          width: 180px;
          outline: none;
          transition: border-color 0.2s;
        }
        .search-input:focus {
          border-color: #64748b;
        }
        .search-icon {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.75rem;
          color: #64748b;
        }

        /* TABLE */
        .table-responsive {
          overflow-x: auto;
          background-color: #0a0f1d;
          border-radius: 0.5rem;
          border: 1px solid #1e293b;
        }
        .erp-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.75rem;
        }
        .erp-table th {
          background-color: #131d33;
          border-b: 1px solid #1e293b;
          padding: 0.75rem 1rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94a3b8;
        }
        .erp-table td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(30, 41, 59, 0.6);
          vertical-align: middle;
        }
        
        /* Row Status Styling */
        .row-critical { background-color: rgba(239, 68, 68, 0.05); }
        .row-critical:hover { background-color: rgba(239, 68, 68, 0.1); }
        .row-transfer { background-color: rgba(245, 158, 11, 0.03); }
        .row-transfer:hover { background-color: rgba(245, 158, 11, 0.07); }
        .row-normal { background-color: rgba(16, 185, 129, 0.02); }
        .row-normal:hover { background-color: rgba(16, 185, 129, 0.06); }
        .row-control:hover { background-color: rgba(255, 255, 255, 0.02); }

        .cell-mono {
          font-family: monospace;
          color: #94a3b8;
          font-size: 0.7rem;
        }
        .cell-bold {
          font-weight: 700;
          color: #f1f5f9;
        }
        .text-right { text-align: right; }
        .text-center { text-align: center; }

        /* Status Badges */
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.625rem;
          border-radius: 9999px;
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .status-badge-critical {
          background-color: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .badge-pulse {
          height: 0.375rem;
          width: 0.375rem;
          background-color: #ef4444;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        }
        .status-badge-transfer {
          background-color: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .status-badge-normal {
          background-color: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .status-badge-control {
          background-color: rgba(249, 115, 22, 0.15);
          color: #fb923c;
          border: 1px solid rgba(249, 115, 22, 0.3);
        }

        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 4px rgba(239, 68, 68, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }

        /* SYSTEM CONTROLS FOOTER */
        .system-footer {
          background-color: #111a2e;
          border: 1px solid #1e293b;
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          align-items: center;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        @media (min-width: 768px) {
          .system-footer {
            flex-direction: row;
            justify-content: space-between;
          }
        }
        .footer-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94a3b8;
        }
        .footer-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          width: 100%;
        }
        @media (min-width: 768px) {
          .footer-buttons {
            width: auto;
            justify-content: flex-end;
          }
        }
        .btn-footer {
          flex: 1;
          background-color: #18233a;
          color: #cbd5e1;
          border: 1px solid #334155;
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          white-space: nowrap;
        }
        .btn-footer:hover {
          background-color: #202f4e;
          color: #ffffff;
        }
        .badge-sheets {
          flex: 1;
          background-color: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: #34d399;
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          white-space: nowrap;
        }
        .btn-excel {
          flex: 1;
          background-color: #4f46e5;
          color: #ffffff;
          border: 1px solid rgba(79, 70, 229, 0.3);
          padding: 0.5rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          white-space: nowrap;
          box-shadow: 0 4px 10px rgba(79, 70, 229, 0.2);
        }
        .btn-excel:hover {
          background-color: #4338ca;
          box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
        }
      `}</style>

      {/* ШАПКА ПАНЕЛИ */}
      <header className="erp-header">
        <div className="header-title-wrapper">
          <span className="header-logo">🏭</span>
          <h1 className="header-title">
            Пром-Закупка: <span className="accent-green">Премиксы</span>
          </h1>
        </div>
        <div className="header-meta">
          <div className="meta-item">
            <span>👤</span>
            <span>С3: <strong>Алексей</strong></span>
          </div>
          <div className="meta-item">
            <span>📅</span>
            <span className="meta-badge">17.05.2026</span>
          </div>
        </div>
      </header>

      {/* ПАНЕЛЬ ЗАГРУЗКИ ДОКУМЕНТОВ */}
      <section style={{ marginBottom: '1.5rem' }}>
        <div className="section-header">
          <span>📥</span> Панель загрузки документов <span>(Входные данные)</span>
        </div>

        <div className="cards-grid">
          {/* ПОЛОЦК */}
          <div className="card card-polotsk">
            <div className="card-top">
              <div className="card-header-row">
                <div className="card-title-group">
                  <span>📁</span>
                  <h3 className="card-title">ПОЛОЦК КХП (Остатки)</h3>
                </div>
                <span className="format-badge badge-green">XLS</span>
              </div>
              <div className="filename-box">[Премикс Амбарка 13.05.26..(3).xls]</div>
              <div className="status-indicator">
                <span className="dot dot-green"></span>
                <span>Загружено сегодня в 08:15</span>
              </div>
            </div>
            <button className="btn btn-card-green">КНОПКА: Спарсить и обновить</button>
          </div>

          {/* 1С МИНСК */}
          <div className="card card-minsk">
            <div className="card-top">
              <div className="card-header-row">
                <div className="card-title-group">
                  <span>🏢</span>
                  <h3 className="card-title">1С МИНСК (Липки)</h3>
                </div>
                <span className="format-badge badge-amber">XLSX</span>
              </div>
              <div className="filename-box">[07.05.2026 Полоцк Расход сырья_2.xlsx]</div>
              <div className="status-indicator">
                <span className="dot dot-amber"></span>
                <span>Обновлено сегодня в 09:00</span>
              </div>
            </div>
            <button className="btn btn-card-amber">КНОПКА: Синхронизировать</button>
          </div>

          {/* РЕЦЕПТ */}
          <div className="card card-recipe">
            <div className="card-top">
              <div className="card-header-row">
                <div className="card-title-group">
                  <span>📜</span>
                  <h3 className="card-title">РЕЦЕПТ ТЕХНОЛОГА</h3>
                </div>
                <span className="format-badge badge-sky">PDF</span>
              </div>
              <div className="filename-box">[Рецепты ПЛЦ №105.pdf]</div>
              <div className="status-indicator">
                <span className="dot dot-sky"></span>
                <span>Последний: <strong>ПЛЦ №105 (Вчера)</strong></span>
              </div>
            </div>
            <button className="btn btn-card-sky">КНОПКА: Разобрать на строки</button>
          </div>
        </div>
      </section>

      {/* СЫРЬЁ В ПУТИ */}
      <section className="transit-section">
        <div className="section-header">
          <span>🚚</span> Сырьё в пути <span>(Ручной ввод)</span>
        </div>

        <form onSubmit={handleAddTransit} className="transit-form">
          <div className="form-group">
            <label className="form-label">Выбрать сырье:</label>
            <select 
              value={selectedMaterial}
              onChange={(e) => setSelectedMaterial(e.target.value)}
              className="input-dark"
              required
            >
              <option value="">Выберите из списка...</option>
              {inventory.map(item => (
                <option key={item.id} value={item.name}>{item.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Количество, кг:</label>
            <input 
              type="number" 
              placeholder="Введите вес"
              value={transitAmount}
              onChange={(e) => setTransitAmount(e.target.value)}
              className="input-dark"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Дата прихода:</label>
            <input 
              type="date"
              value={transitDate}
              onChange={(e) => setTransitDate(e.target.value)}
              className="input-dark"
              required
            />
          </div>

          <button type="submit" className="btn-submit">+ Добавить поставку</button>
        </form>

        <div className="transit-display-box">
          <span className="transit-title">⚡ Текущий транзит:</span>
          {transits.length === 0 ? (
            <span style={{ color: '#64748b' }}>Нет активных поставок в пути</span>
          ) : (
            transits.map(t => (
              <div key={t.id} className="transit-tag">
                <span>• {t.name} ({t.amount} кг) — ожидается {t.date}</span>
                <button 
                  type="button" 
                  onClick={() => handleDeleteTransit(t.id, t.name, t.amount)}
                  className="btn-delete-tag"
                  title="Удалить транзит"
                >
                  [❌ Удалить]
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* МОНИТОР ДЕФИЦИТА */}
      <section className="monitor-section">
        <div className="monitor-bar">
          <div className="section-header" style={{ marginBottom: 0 }}>
            <span>📊</span> Монитор дефицита и контроля позиций <span>(Аналитика на лету)</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            {/* Группа фильтров */}
            <div className="filter-group">
              <button 
                onClick={() => setActiveFilter('ALL')}
                className={`btn-filter ${activeFilter === 'ALL' ? 'active-all' : ''}`}
              >
                Все позиции
              </button>
              <button 
                onClick={() => setActiveFilter('CRITICAL')}
                className={`btn-filter ${activeFilter === 'CRITICAL' ? 'active-critical' : ''}`}
              >
                <span className="filter-dot filter-dot-red"></span>
                Срочно закупать
              </button>
              <button 
                onClick={() => setActiveFilter('TRANSFER')}
                className={`btn-filter ${activeFilter === 'TRANSFER' ? 'active-transfer' : ''}`}
              >
                <span className="filter-dot filter-dot-amber"></span>
                Перевезти с Липковской
              </button>
            </div>

            {/* Поиск */}
            <div className="search-wrapper">
              <span className="search-icon">🔍</span>
              <input 
                type="text" 
                placeholder="Поиск сырья..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
          </div>
        </div>

        {/* ТАБЛИЦА */}
        <div className="table-responsive">
          <table className="erp-table">
            <thead>
              <tr>
                <th className="text-center" style={{ width: '60px' }}>ID</th>
                <th>Системное имя</th>
                <th className="text-right">Полоцк КХП, кг</th>
                <th className="text-right">Липки (Минск)</th>
                <th className="text-right">В пути, кг</th>
                <th className="text-right">Свободный, кг</th>
                <th className="text-center" style={{ width: '200px' }}>Текущий статус</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center" style={{ padding: '2rem', color: '#64748b' }}>
                    Данные отсутствуют или не найдены по фильтру
                  </td>
                </tr>
              ) : (
                filteredInventory.map((item) => {
                  let rowClass = 'row-control';
                  let statusBadgeMarkup = null;
                  let freeColorStyle = {};

                  if (item.status === 'СРОЧНО ЗАКУПАТЬ') {
                    rowClass = 'row-critical';
                    freeColorStyle = { color: '#f87171', fontWeight: 'bold' };
                    statusBadgeMarkup = (
                      <span className="status-badge status-badge-critical">
                        <span className="badge-pulse"></span>
                        СРОЧНО ЗАКУПАТЬ
                      </span>
                    );
                  } else if (item.status === 'ПЕРЕВЕЗТИ С ЛИП') {
                    rowClass = 'row-transfer';
                    freeColorStyle = { color: '#fbbf24' };
                    statusBadgeMarkup = (
                      <span className="status-badge status-badge-transfer">
                        <span className="filter-dot filter-dot-amber" style={{ display: 'inline-block' }}></span>
                        ПЕРЕВЕЗТИ С ЛИП
                      </span>
                    );
                  } else if (item.status === 'ЗАПАС В НОРМЕ') {
                    rowClass = 'row-normal';
                    freeColorStyle = { color: '#34d399' };
                    statusBadgeMarkup = (
                      <span className="status-badge status-badge-normal">
                        <span className="filter-dot" style={{ backgroundColor: '#10b981', display: 'inline-block' }}></span>
                        ЗАПАС В НОРМЕ
                      </span>
                    );
                  } else if (item.status === 'НА КОНТРОЛЕ') {
                    statusBadgeMarkup = (
                      <span className="status-badge status-badge-control">
                        <span className="filter-dot" style={{ backgroundColor: '#f97316', display: 'inline-block' }}></span>
                        НА КОНТРОЛЕ
                      </span>
                    );
                  }

                  return (
                    <tr key={item.id} className={rowClass}>
                      <td className="text-center cell-mono">{item.id}</td>
                      <td className="cell-bold">{item.name}</td>
                      <td className="text-right cell-mono" style={{ color: '#cbd5e1' }}>
                        {item.polotsk.toLocaleString('ru-RU')}
                      </td>
                      <td className="text-right cell-mono" style={{ color: '#cbd5e1' }}>
                        {item.lipki.toLocaleString('ru-RU')}
                      </td>
                      <td className="text-right cell-mono" style={{ color: '#94a3b8' }}>
                        {item.inTransit > 0 ? `+${item.inTransit.toLocaleString('ru-RU')}` : '0'}
                      </td>
                      <td className="text-right cell-mono" style={freeColorStyle}>
                        {item.free.toLocaleString('ru-RU')}
                      </td>
                      <td className="text-center">
                        {statusBadgeMarkup}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* СИСТЕМНЫЕ КНОПКИ УПРАВЛЕНИЯ */}
      <footer className="system-footer">
        <div className="footer-left">
          <span>⚙️</span> Системные кнопки управления
        </div>

        <div className="footer-buttons">
          <button className="btn-footer">
            <span>🔗</span> Открыть базу синонимов (Мэппинг)
          </button>
          
          <div className="badge-sheets">
            <span className="dot dot-green" style={{ animation: 'pulse 1.5s infinite' }}></span>
            База Google Sheets: СВЯЗАНО
          </div>

          <button className="btn-excel">
            <span>📥</span> Скачать отчёт С3 в Excel
          </button>
        </div>
      </footer>

    </div>
  );
}
