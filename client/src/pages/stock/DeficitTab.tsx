import { useState, Fragment } from 'react';
import { DeficitRow, fmt, SIGNAL_LABEL, SIGNAL_STYLE, STATUS_STYLE } from './types';

export default function DeficitTab({ deficit, loading }: { deficit: DeficitRow[]; loading: boolean }) {
  const [onlyDeficit, setOnlyDeficit] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (uid: string) => {
    const next = new Set(open);
    next.has(uid) ? next.delete(uid) : next.add(uid);
    setOpen(next);
  };

  const rows = onlyDeficit ? deficit.filter(r => r.signal !== 'ok') : deficit;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 max-w-2xl">
          По каждому сырью: остаток, суммарное списание, итог (минус = дефицит) и из
          каких рецептов он сложился. Раскройте строку, чтобы перераспределить объёмы.
        </p>
        <label className="text-xs text-gray-300 flex items-center gap-1.5 whitespace-nowrap ml-3">
          <input type="checkbox" checked={onlyDeficit} onChange={() => setOnlyDeficit(v => !v)} />
          Только дефицит
        </label>
      </div>
      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="text-left px-3 py-2">Сырьё</th>
              <th className="text-right px-3 py-2">Полоцк</th>
              <th className="text-right px-3 py-2">Липковская</th>
              <th className="text-right px-3 py-2">Списано</th>
              <th className="text-right px-3 py-2">Итог</th>
              <th className="text-left px-3 py-2">Сигнал</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isOpen = open.has(r.raw_uid);
              return (
                <Fragment key={r.raw_uid}>
                  <tr className="border-t border-gray-800 hover:bg-gray-900/40 cursor-pointer"
                    onClick={() => toggle(r.raw_uid)}>
                    <td className="px-3 py-1.5 text-center text-gray-500">
                      {r.contributors.length ? (isOpen ? '▾' : '▸') : ''}
                    </td>
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
                  {isOpen && r.contributors.length > 0 && (
                    <tr key={r.raw_uid + '_c'} className="bg-gray-900/30 border-t border-gray-800/60">
                      <td></td>
                      <td colSpan={6} className="px-3 py-2">
                        <div className="text-xs text-gray-400 mb-1">Потребляют это сырьё:</div>
                        <div className="space-y-1">
                          {r.contributors.map(c => (
                            <div key={c.recipe_uid} className="flex items-center gap-2 text-xs">
                              <span className={`border px-1.5 py-0.5 rounded ${STATUS_STYLE[c.status] || 'bg-gray-700/30 text-gray-300 border-gray-600'}`}>
                                {c.status || '—'}
                              </span>
                              <span className="text-gray-200">{c.recipe_name}</span>
                              <span className="text-yellow-300 ml-auto">−{fmt(c.qty)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-500">
                {onlyDeficit ? 'Дефицита нет' : 'Нет данных'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
