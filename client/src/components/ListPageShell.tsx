import { ReactNode } from 'react';

/**
 * Общая оболочка для страниц-списков (Исключённые, Синонимы, Аналоги и т.д.).
 * Единый паттерн: каждый список открывается отдельной страницей с шапкой,
 * кнопкой возврата на главную и (опционально) индикатором загрузки/обновлением.
 * Дашборд не перегружаем — справочные списки живут на своих вкладках.
 */
export default function ListPageShell({
  title,
  badge,
  onBack,
  loading,
  error,
  onRefresh,
  children,
}: {
  title: string;
  badge?: string;
  onBack: () => void;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-xs border border-gray-700 text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition"
          >
            ← На главную
          </button>
          <span className="text-lg font-bold text-white">{title}</span>
          {badge && (
            <span className="text-xs text-gray-500 border border-gray-700 rounded px-2 py-0.5">{badge}</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          {loading && <span className="text-xs text-blue-400 animate-pulse">загрузка...</span>}
          {error && <span className="text-xs text-red-400" title={error}>⚠ ошибка загрузки</span>}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-xs border border-gray-700 text-gray-400 px-2 py-1 rounded hover:bg-gray-800 transition"
            >
              ↻ Обновить
            </button>
          )}
        </div>
      </header>

      <div className="p-4 max-w-screen-2xl mx-auto space-y-4">{children}</div>
    </div>
  );
}
