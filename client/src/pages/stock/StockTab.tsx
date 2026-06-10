import { LiveStockRow, fmt, SIGNAL_LABEL, SIGNAL_STYLE } from './types';

export default function StockTab({ live, loading }: { live: LiveStockRow[]; loading: boolean }) {
  return (
    <section>
      <p className="text-xs text-gray-400 mb-3">
        Полоцк + Липковская − списание рецептов (план / в работе / архив). Отменённые
        возвращают сырьё. Минус (красный) — срочно закупать; жёлтый — перевезти с
        Липковской. Товары в пути не учитываются.
      </p>
      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Сырьё</th>
              <th className="text-right px-3 py-2">Полоцк</th>
              <th className="text-right px-3 py-2">Липковская</th>
              <th className="text-right px-3 py-2">Списано</th>
              <th className="text-right px-3 py-2">Доступно</th>
              <th className="text-left px-3 py-2">Сигнал</th>
            </tr>
          </thead>
          <tbody>
            {live.map(r => (
              <tr key={r.raw_uid} className="border-t border-gray-800">
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5 text-right text-gray-400">{fmt(r.plant_qty)}</td>
                <td className="px-3 py-1.5 text-right text-gray-400">{fmt(r.lip_qty)}</td>
                <td className="px-3 py-1.5 text-right text-yellow-300">{r.consumed ? '−' + fmt(r.consumed) : '—'}</td>
                <td className={`px-3 py-1.5 text-right font-semibold ${r.available < 0 ? 'text-red-400' : 'text-white'}`}>{fmt(r.available)}</td>
                <td className="px-3 py-1.5">
                  {r.signal === 'ok' ? (
                    <span className="text-xs text-gray-600">—</span>
                  ) : (
                    <span className={`text-xs border px-2 py-0.5 rounded ${SIGNAL_STYLE[r.signal]}`}>
                      {SIGNAL_LABEL[r.signal]}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!live.length && !loading && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-500">Нет данных по остаткам</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
