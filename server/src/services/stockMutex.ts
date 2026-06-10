/**
 * Общий внутрипроцессный мьютекс на любые операции, меняющие списание сырья со
 * склада (приём рецепта в работу, изменение выработки). Деплой — единственный
 * инстанс (target=vm), поэтому сериализации в памяти достаточно, чтобы две
 * операции не прошли проверку достаточности по одному остатку и не списали
 * сырьё дважды. Критическая секция всегда: проверка склада → запись.
 */
let lock: Promise<void> = Promise.resolve();

export async function withStockMutation<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lock;
  let release!: () => void;
  lock = new Promise<void>(r => (release = r));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
