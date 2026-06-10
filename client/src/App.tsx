import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Excluded from './pages/Excluded';
import Synonyms from './pages/Synonyms';
import Analogs from './pages/Analogs';
import Planning from './pages/Planning';
import RecipesStock from './pages/RecipesStock';

type Tab = 'home' | 'planning' | 'stock' | 'excluded' | 'synonyms' | 'analogs';

function App() {
  const [tab, setTab] = useState<Tab>('home');

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-sm border-b-2 transition ${
      active
        ? 'border-blue-500 text-white'
        : 'border-transparent text-gray-400 hover:text-gray-200'
    }`;

  const goHome = () => setTab('home');

  return (
    <div className="min-h-screen bg-gray-950">
      {/* ─── ВКЛАДКИ ─── */}
      <nav className="bg-gray-900 border-b border-gray-800 px-6 flex gap-1">
        <button className={tabCls(tab === 'home')} onClick={() => setTab('home')}>
          Главная
        </button>
        <button className={tabCls(tab === 'stock')} onClick={() => setTab('stock')}>
          Рецепты и остатки
        </button>
        <button className={tabCls(tab === 'planning')} onClick={() => setTab('planning')}>
          Планирование закупок
        </button>
        <button className={tabCls(tab === 'synonyms')} onClick={() => setTab('synonyms')}>
          База синонимов
        </button>
        <button className={tabCls(tab === 'analogs')} onClick={() => setTab('analogs')}>
          Аналоги / замены
        </button>
        <button className={tabCls(tab === 'excluded')} onClick={() => setTab('excluded')}>
          Исключённые
        </button>
      </nav>

      {tab === 'home' && <Dashboard onOpenPlanning={() => setTab('planning')} />}
      {tab === 'stock' && <RecipesStock onBack={goHome} />}
      {tab === 'planning' && <Planning onBack={goHome} />}
      {tab === 'synonyms' && <Synonyms onBack={goHome} />}
      {tab === 'analogs' && <Analogs onBack={goHome} />}
      {tab === 'excluded' && <Excluded onBack={goHome} />}
    </div>
  );
}

export default App;
