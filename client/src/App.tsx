import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Excluded from './pages/Excluded';

type Tab = 'home' | 'excluded';

function App() {
  const [tab, setTab] = useState<Tab>('home');

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-sm border-b-2 transition ${
      active
        ? 'border-blue-500 text-white'
        : 'border-transparent text-gray-400 hover:text-gray-200'
    }`;

  return (
    <div className="min-h-screen bg-gray-950">
      {/* ─── ВКЛАДКИ ─── */}
      <nav className="bg-gray-900 border-b border-gray-800 px-6 flex gap-1">
        <button className={tabCls(tab === 'home')} onClick={() => setTab('home')}>
          Главная
        </button>
        <button className={tabCls(tab === 'excluded')} onClick={() => setTab('excluded')}>
          Исключённые
        </button>
      </nav>

      {tab === 'home' ? <Dashboard /> : <Excluded onBack={() => setTab('home')} />}
    </div>
  );
}

export default App;
