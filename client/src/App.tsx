import React, { useState, useMemo } from 'react';

// Описание структуры данных для таблицы
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

  // Исходные данные таблицы (в точности как на твоем макете!)
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

  // Состояния для формы ручного ввода транзита
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [transitAmount, setTransitAmount] = useState('');
  const [transitDate, setTransitDate] = useState('');

  // Обработчик добавления поставки в пути
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
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-4 sm:p-6 font-sans antialiased">
      
      {/* ШАПКА ПАНЕЛИ */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-[#151f32] border border-slate-800 rounded-xl px-6 py-4 mb-6 shadow-lg gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏭</span>
          <h1 className="text-lg sm:text-xl font-bold tracking-wider text-slate-100 uppercase">
            Пром-Закупка: <span className="text-emerald-400">Премиксы</span>
          </h1>
        </div>
        <div className="flex items-center gap-6 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">👤</span>
            <span>С3: <strong className="text-slate-200">Алексей</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">📅</span>
            <span className="bg-slate-800 text-slate-300 px-2.5 py-1 rounded-md text-xs font-mono">17.05.2026</span>
          </div>
        </div>
      </header>

      {/* ЗАГРУЗКА ДОКУМЕНТОВ */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-3 px-1 text-slate-400 text-xs sm:text-sm uppercase font-semibold tracking-wider">
          <span>📥</span>
          <h2>Панель загрузки документов <span className="text-slate-500 font-normal">(Входные данные)</span></h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* ПОЛОЦК */}
          <div className="bg-[#111a2e] border border-emerald-500/30 rounded-xl p-5 hover:border-emerald-500/50 transition shadow-md flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📁</span>
                  <h3 className="font-bold text-slate-200">ПОЛОЦК КХП (Остатки)</h3>
                </div>
                <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">XLS</span>
              </div>
              <p className="text-xs text-slate-400 bg-slate-900/50 p-2 rounded border border-slate-800 mb-3 truncate">
                [Премикс Амбарка 13.05.26..(3).xls]
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-300 mb-4">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Загружено сегодня в 08:15</span>
              </div>
            </div>
            <button className="w-full bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/40 hover:border-emerald-500 text-emerald-300 hover:text-white py-2.5 px-4 rounded-lg font-medium text-xs tracking-wider transition uppercase">
              КНОПКА: Спарсить и обновить
            </button>
          </div>

          {/* 1С МИНСК */}
          <div className="bg-[#111a2e] border border-amber-500/30 rounded-xl p-5 hover:border-amber-500/50 transition shadow-md flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🏢</span>
                  <h3 className="font-bold text-slate-200">1С МИНСК (Липки)</h3>
                </div>
                <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20 font-mono">XLSX</span>
              </div>
              <p className="text-xs text-slate-400 bg-slate-900/50 p-2 rounded border border-slate-800 mb-3 truncate">
                [07.05.2026 Полоцк Расход сырья_2.xlsx]
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-300 mb-4">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                <span>Обновлено сегодня в 09:00</span>
              </div>
            </div>
            <button className="w-full bg-amber-600/20 hover:bg-amber-600 border border-amber-500/40 hover:border-amber-500 text-amber-300 hover:text-white py-2.5 px-4 rounded-lg font-medium text-xs tracking-wider transition uppercase">
              КНОПКА: Синхронизировать
            </button>
          </div>

          {/* РЕЦЕПТ */}
          <div className="bg-[#111a2e] border border-sky-500/30 rounded-xl p-5 hover:border-sky-500/50 transition shadow-md flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📜</span>
                  <h3 className="font-bold text-slate-200">РЕЦЕПТ ТЕХНОЛОГА</h3>
                </div>
                <span className="text-xs bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded border border-sky-500/20 font-mono">PDF</span>
              </div>
              <p className="text-xs text-slate-400 bg-slate-900/50 p-2 rounded border border-slate-800 mb-3 truncate">
                [Рецепты ПЛЦ №105.pdf]
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-300 mb-4">
                <span className="h-2 w-2 rounded-full bg-sky-500"></span>
                <span>Последний: <strong className="text-sky-300">ПЛЦ №105 (Вчера)</strong></span>
              </div>
            </div>
            <button className="w-full bg-sky-600/20 hover:bg-sky-600 border border-sky-500/40 hover:border-sky-500 text-sky-300 hover:text-white py-2.5 px-4 rounded-lg font-medium text-xs tracking-wider transition uppercase">
              КНОПКА: Разобрать на строки
            </button>
          </div>

        </div>
      </section>

      {/* СЫРЬЁ В ПУТИ */}
      <section className="mb-6 bg-[#111a2e] border border-slate-850 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-4 text-slate-400 text-xs sm:text-sm uppercase font-semibold tracking-wider">
          <span>🚚</span>
          <h2>Сырьё в пути <span className="text-slate-500 font-normal">(Ручной ввод)</span></h2>
        </div>

        <form onSubmit={handleAddTransit} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end mb-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Выбрать сырье:</label>
            <select 
              value={selectedMaterial}
              onChange={(e) => setSelectedMaterial(e.target.value)}
              className="w-full bg-[#18233a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-slate-500 transition"
              required
            >
              <option value="">Выберите из списка...</option>
              {inventory.map(item => (
                <option key={item.id} value={item.name}>{item.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Количество, кг:</label>
            <input 
              type="number" 
              placeholder="Введите вес"
              value={transitAmount}
              onChange={(e) => setTransitAmount(e.target.value)}
              className="w-full bg-[#18233a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-slate-500 transition"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Дата прихода:</label>
            <input 
              type="date"
              value={transitDate}
              onChange={(e) => setTransitDate(e.target.value)}
              className="w-full bg-[#18233a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-slate-500 transition"
              required
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-[#1e293b] hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-200 py-2 rounded-lg text-sm font-semibold transition"
          >
            + Добавить поставку
          </button>
        </form>

        <div className="bg-[#0b101c] rounded-lg p-3 border border-slate-800 flex flex-wrap gap-2 items-center text-xs text-slate-300">
          <span className="text-amber-500 font-bold">⚡ Текущий транзит:</span>
          {transits.length === 0 ? (
            <span className="text-slate-500">Нет active-поставок в пути</span>
          ) : (
            transits.map(t => (
              <div key={t.id} className="bg-[#162137] px-3 py-1 rounded-md border border-slate-700/50 flex items-center gap-2">
                <span>• {t.name} ({t.amount} кг) — ожидается {t.date}</span>
                <button 
                  type="button" 
                  onClick={() => handleDeleteTransit(t.id, t.name, t.amount)}
                  className="text-red-400 hover:text-red-300 font-bold ml-1"
                >
                  [❌ Удалить]
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* МОНИТОР ДЕФИЦИТА */}
      <section className="bg-[#111a2e] border border-slate-850 rounded-xl p-5 shadow-lg mb-6">
        
        <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 mb-5 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-xs sm:text-sm uppercase font-semibold tracking-wider">
            <span>📊</span>
            <h2>Монитор дефицита и контроля позиций <span className="text-slate-500 font-normal">(Аналитика на лету)</span></h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-[#0b101c] p-1 rounded-lg border border-slate-800 flex gap-1">
              <button 
                onClick={() => setActiveFilter('ALL')}
                className={`px-3 py-1 rounded text-xs font-medium transition ${activeFilter === 'ALL' ? 'bg-slate-800 text-white border border-slate-700' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Все позиции
              </button>
              <button 
                onClick={() => setActiveFilter('CRITICAL')}
                className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition ${activeFilter === 'CRITICAL' ? 'bg-red-950 text-red-300 border border-red-900/50' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                Срочно закупать
              </button>
              <button 
                onClick={() => setActiveFilter('TRANSFER')}
                className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition ${activeFilter === 'TRANSFER' ? 'bg-amber-950 text-amber-300 border border-amber-900/50' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                Перевезти с Липковской
              </button>
            </div>

            <div className="relative">
              <input 
                type="text" 
                placeholder="Поиск сырья..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[#18233a] border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-slate-500 transition placeholder:text-slate-500 w-44"
              />
              <span className="absolute left-2.5 top-2 text-slate-500 text-xs">🔍</span>
            </div>
          </div>
        </div>

        {/* ТАБЛИЦА */}
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0a0f1d]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#131d33] border-b border-slate-800 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                <th className="py-3 px-4 w-16 text-center">ID</th>
                <th className="py-3 px-4">Системное имя</th>
                <th className="py-3 px-4 text-right">Полоцк КХП, кг</th>
                <th className="py-3 px-4 text-right">Липки (Минск)</th>
                <th className="py-3 px-4 text-right">В пути, кг</th>
                <th className="py-3 px-4 text-right">Свободный, кг</th>
                <th className="py-3 px-4 text-center w-52">Текущий статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-medium">
              {filteredInventory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-500">
                    Данные отсутствуют или не найдены по фильтру
                  </td>
                </tr>
              ) : (
                filteredInventory.map((item) => {
                  let rowBg = 'hover:bg-slate-800/20';
                  let statusBadge = '';
                  let freeColorClass = 'text-slate-200';

                  if (item.status === 'СРОЧНО ЗАКУПАТЬ') {
                    rowBg = 'bg-red-950/15 hover:bg-red-950/25';
                    statusBadge = 'bg-red-500/15 text-red-400 border border-red-500/30';
                    freeColorClass = 'text-red-400 font-bold';
                  } else if (item.status === 'ПЕРЕВЕЗТИ С ЛИП') {
                    rowBg = 'bg-amber-950/10 hover:bg-amber-950/20';
                    statusBadge = 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
                    freeColorClass = 'text-amber-400';
                  } else if (item.status === 'ЗАПАС В НОРМЕ') {
                    rowBg = 'bg-emerald-950/10 hover:bg-emerald-950/20';
                    statusBadge = 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
                    freeColorClass = 'text-emerald-400';
                  } else if (item.status === 'НА КОНТРОЛЕ') {
                    rowBg = 'bg-slate-800/10 hover:bg-slate-800/20';
                    statusBadge = 'bg-orange-500/15 text-orange-400 border border-orange-500/30';
                  }

                  return (
                    <tr key={item.id} className={`transition-colors ${rowBg}`}>
                      <td className="py-3 px-4 text-center text-slate-500 font-mono text-[10px]">{item.id}</td>
                      <td className="py-3 px-4 text-slate-200 font-semibold">{item.name}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300">{item.polotsk.toLocaleString('ru-RU')}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300">{item.lipki.toLocaleString('ru-RU')}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-400">{item.inTransit > 0 ? `+${item.inTransit.toLocaleString('ru-RU')}` : '0'}</td>
                      <td className={`py-3 px-4 text-right font-mono ${freeColorClass}`}>{item.free.toLocaleString('ru-RU')}</td>
                      <td className="py-2 px-4 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${statusBadge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            item.status === 'СРОЧНО ЗАКУПАТЬ' ? 'bg-red-500 animate-pulse' :
                            item.status === 'ПЕРЕВЕЗТИ С ЛИП' ? 'bg-amber-500' :
                            item.status === 'ЗАПАС В НОРМЕ' ? 'bg-emerald-500' : 'bg-orange-500'
                          }`}></span>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* КНОПКИ УПРАВЛЕНИЯ */}
      <footer className="bg-[#111a2e] border border-slate-850 rounded-xl p-4 shadow-lg flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-slate-400 text-xs uppercase font-semibold tracking-wider">
          <span>⚙️</span>
          <h3>Системные кнопки управления</h3>
        </div>

        <div className="flex flex-wrap gap-3 w-full md:w-auto justify-end">
          <button className="flex-1 md:flex-none bg-[#18233a] hover:bg-[#202f4e] border border-slate-700 text-slate-300 hover:text-white py-2.5 px-4 rounded-lg text-xs font-medium transition flex items-center justify-center gap-2">
            <span>🔗</span>
            Открыть базу синонимов (Мэппинг)
          </button>
          
          <div className="flex-1 md:flex-none bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-4 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            База Google Sheets: СВЯЗАНО
          </div>

          <button className="flex-1 md:flex-none bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 text-white py-2 px-4 rounded-lg text-xs font-semibold tracking-wide transition flex items-center justify-center gap-2 shadow-md shadow-indigo-900/20">
            <span>📥</span>
            Скачать отчёт С3 в Excel
          </button>
        </div>
      </footer>

    </div>
  );
}
