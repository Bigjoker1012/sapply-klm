export type Signal = 'critical' | 'transfer' | 'ok';

export interface LiveStockRow {
  raw_uid: string;
  name: string;
  plant_qty: number;
  lip_qty: number;
  base: number;
  consumed: number;
  available: number;
  signal: Signal;
}

export interface Contributor {
  recipe_uid: string;
  recipe_name: string;
  status: string;
  qty: number;
}

export interface DeficitRow extends LiveStockRow {
  contributors: Contributor[];
}

export interface Recipe {
  recipe_uid: string;
  code: string;
  full_name: string;
  date: string;
  batch_t: number;
  status: string;
  file_name: string;
}

export interface Snapshot {
  sheet: string;
  date: string;
  rows: number;
  qty: number;
  source: string;
}

export const fmt = (n: number) =>
  (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('ru-RU');

// Формат с тремя знаками после запятой (для графы «Списано» на остатках —
// списание считается с мех. потерями, нужна точность до грамма).
export const fmt3 = (n: number) =>
  (Math.round((n + Number.EPSILON) * 1000) / 1000).toLocaleString('ru-RU', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

export const SHEET_LABEL: Record<string, string> = {
  PlantStock: 'Полоцк',
  LipStock: 'Липковская',
};

// Стили бейджа статуса рецепта.
export const STATUS_STYLE: Record<string, string> = {
  'план': 'bg-blue-500/15 text-blue-300 border-blue-600/40',
  'в работе': 'bg-green-500/15 text-green-300 border-green-600/40',
  'активен': 'bg-green-500/15 text-green-300 border-green-600/40',
  'архив': 'bg-purple-500/15 text-purple-300 border-purple-600/40',
  'удалён': 'bg-purple-500/15 text-purple-300 border-purple-600/40',
  'отменён': 'bg-yellow-500/15 text-yellow-300 border-yellow-600/40',
};

// Подпись и стиль сигнала к закупке/перевозке.
export const SIGNAL_LABEL: Record<Signal, string> = {
  critical: 'СРОЧНО ЗАКУПАТЬ',
  transfer: 'перевезти с Липковской',
  ok: '—',
};

export const SIGNAL_STYLE: Record<Signal, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-600/50',
  transfer: 'bg-yellow-500/15 text-yellow-300 border-yellow-600/40',
  ok: 'text-gray-500 border-transparent',
};
