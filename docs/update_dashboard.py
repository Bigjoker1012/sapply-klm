import sys

# Read the file
with open('/opt/sapply-klm/client/src/pages/Dashboard.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Update UnmatchedRow component to add checkbox
old_component = '''function UnmatchedRow({ item, rawMaterials, onConfirm, onDiscard }: {
  item: UnmatchedItem;
  rawMaterials: RawMaterial[];
  onConfirm: (item: UnmatchedItem, raw_uid: string) => void;
  onDiscard: (item: UnmatchedItem) => void;
}) {
  const [selectedUid, setSelectedUid] = useState('');
  const [aiHint, setAiHint] = useState<AiHint | null>(null);
  const [aiLoading, setAiLoading] = useState(false);'''

new_component = '''function UnmatchedRow({ item, rawMaterials, onConfirm, onDiscard }: {
  item: UnmatchedItem;
  rawMaterials: RawMaterial[];
  onConfirm: (item: UnmatchedItem, raw_uid: string, remember: boolean) => void;
  onDiscard: (item: UnmatchedItem) => void;
}) {
  const [selectedUid, setSelectedUid] = useState('');
  const [aiHint, setAiHint] = useState<AiHint | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [rememberAlias, setRememberAlias] = useState(true);'''

# Update the confirm button to pass rememberAlias
old_confirm_button = '''        <button
          disabled={!selectedUid}
          onClick={() => onConfirm(item, selectedUid)}
          className="bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded disabled:opacity-40 transition shrink-0"
        >
          ✓
        </button>'''

new_confirm_button = '''        <label className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
          <input
            type="checkbox"
            checked={rememberAlias}
            onChange={e => setRememberAlias(e.target.checked)}
            className="rounded"
          />
          Запомнить
        </label>
        <button
          disabled={!selectedUid}
          onClick={() => onConfirm(item, selectedUid, rememberAlias)}
          className="bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded disabled:opacity-40 transition shrink-0"
        >
          ✓
        </button>'''

# Update handleConfirmUnmatched to accept remember parameter
old_handler = '''  const handleConfirmUnmatched = async (item: UnmatchedItem, raw_uid: string) => {
    // Привязываем синоним один раз, затем закрываем ВСЕ строки очереди с тем же
    // текстом (повторные загрузки одного файла создают дубли в ReviewQueue).
    const sameText = unmatched.filter(u => u.original_text === item.original_text);
    await axios.post(`${API}/upload/unmatched/confirm`, {
      queueId: item.id,
      raw_uid,
      synonym: item.original_text,
    });'''

new_handler = '''  const handleConfirmUnmatched = async (item: UnmatchedItem, raw_uid: string, remember: boolean = true) => {
    // Привязываем синоним один раз, затем закрываем ВСЕ строки очереди с тем же
    // текстом (повторные загрузки одного файла создают дубли в ReviewQueue).
    const sameText = unmatched.filter(u => u.original_text === item.original_text);
    await axios.post(`${API}/upload/unmatched/confirm`, {
      queueId: item.id,
      raw_uid,
      synonym: remember ? item.original_text : undefined,
    });'''

# Apply all replacements
content = content.replace(old_component, new_component)
content = content.replace(old_confirm_button, new_confirm_button)
content = content.replace(old_handler, new_handler)

# Write back
with open('/opt/sapply-klm/client/src/pages/Dashboard.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Dashboard.tsx updated successfully')
