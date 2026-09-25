import { useState } from 'react';
import { LiveStockRow, DeficitRow, Recipe, fmt, fmt3, SIGNAL_LABEL, SIGNAL_STYLE } from './types';
import StockCalculator from './StockCalculator';

interface Props {
  live: LiveStockRow[];
  deficit: DeficitRow[];
  recipes: Recipe[];
  loading: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (m: string) => void;
  reload: () => Promise<void>;
}

export default function StockTab({ live, deficit, recipes, loading, busy, setBusy, flash, reload }: Props) {
  const [calcUid, setCalcUid] = useState<string | null>(null);

  const deficitMap = new Map<string, DeficitRow>();
  deficit.forEach(d => deficitMap.set(d.raw_uid, d));

  const calcRow = calcUid ? deficitMap.get(calcUid) : undefined;

  return (
    <section>
      <p className="text-xs text-gray-400 mb-3">
        Полоцк + Липковская + в пути − списание рецептов (план / в работе / архив).
        Отменённые возвращают сырьё. Минус (красный) — срочно закупать; жёлтый —
        перевезти с Липковской. Товары «в пути» (заказ с «Планирования») входят в
        доступный остаток. Клик по остатку — калькулятор распределения.
      </p>
      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs">
            <tr>
              <th className="text-left px-3 py-2">Сырьё</th>
              <th className="text-right px-3 py-2">Полоцк</th>
              <th className="text-right px-3 py-2">Липковская</th>
              <th className="text-right px-3 py-2">В пути</th>
              <th className="text-right px-3 py-2">Списано</th>
              <th className="text-right px-3 py-2">Доступно</th>
              <th className="text-left px-3 py-2">Сигнал</th>
            </tr>
          </thead>
          <tbody>
            {live.map(r => {
              const hasContributors = deficitMap.get(r.raw_uid)?.contributors.length;
              return (
                <tr key={r.raw_uid} className="border-t border-gray-800">
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right text-gray-400">{fmt(r.plant_qty)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-400">{fmt(r.lip_qty)}</td>
                  <td className="px-3 py-1.5 text-right text-blue-300">{r.inbound_qty ? '+' + fmt(r.inbound_qty) : '—'}</td>
                  <td className="px-3 py-1.5 text-right text-yellow-300">{r.consumed ? '−' + fmt3(r.consumed) : '—'}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${hasContributors ? 'hover:text-blue-300 cursor-pointer hover:underline' : ''} ${r.available < 0 ? 'text-red-400' : 'text-white'}`}
                    title={hasContributors ? 'Открыть калькулятор распределения' : undefined}
                    onClick={hasContributors ? () => setCalcUid(r.raw_uid) : undefined}>
                    {fmt(r.available)}
                  </td>
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
              );
            })}
            {!live.length && !loading && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-500">Нет данных по остаткам</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {calcUid && calcRow && (
        <StockCalculator
          raw_uid={calcRow.raw_uid}
          name={calcRow.name}
          available={calcRow.available}
          contributors={calcRow.contributors}
          recipes={recipes}
          busy={busy}
          setBusy={setBusy}
          flash={flash}
          reload={reload}
          onClose={() => setCalcUid(null)}
        />
      )}
    </section>
  );
}
