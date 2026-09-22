import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

const API = '/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { tool: string; args: string[] }[];
  toolResults?: Record<string, any>;
  timestamp: Date;
}

/** Strip [TOOL: name(args)] markers from displayed text */
const stripToolCalls = (text: string): string =>
  text.replace(/\[TOOL:\s*\w+\([^)]*\)\]/g, '').trim();

/** Simple markdown → HTML renderer */
const renderMarkdown = (text: string): string => {
  // First pass: handle tables
  const lines = text.split('\n');
  const processed: string[] = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    // Table row: starts and ends with |
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
      // Skip separator rows (----)
      if (cells.every(c => /^[-:\s]+$/.test(c))) continue;
      if (!inTable) { processed.push('<table class="w-full text-sm border-collapse mb-3">'); inTable = true; }
      processed.push('<tr>' + cells.map(c => `<td class="px-3 py-1.5 border border-gray-700 text-sm">${c}</td>`).join('') + '</tr>');
    } else {
      if (inTable) { processed.push('</table>'); inTable = false; }
      processed.push(line);
    }
  }
  if (inTable) processed.push('</table>');
  text = processed.join('\n');

  // Second pass: inline formatting
  let html = text
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-white mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-white mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-white mt-5 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    // Blockquotes
    .replace(/^>\s*(.+)$/gm, '<div class="border-l-4 border-blue-500 pl-3 text-gray-300 italic my-1">$1</div>')
    // Horizontal rules
    .replace(/^---+$/gm, '<hr class="border-gray-700 my-3"/>')
    // List items — handle both "- " and lines already starting with "•"
    .replace(/^- \*\*(.+?)\*\*\s*[—–]\s*(.+)$/gm, '<div class="ml-4 mb-1">• <strong class="text-white">$1</strong> — $2</div>')
    .replace(/^- \*\*(.+?)\*\*$/gm, '<div class="ml-4 mb-1">• <strong class="text-white">$1</strong></div>')
    .replace(/^- (.+)$/gm, '<div class="ml-4 mb-1">• $1</div>')
    .replace(/^(\d+)\. \*\*(.+?)\*\*\s*[—–]\s*(.+)$/gm, '<div class="ml-4 mb-1">$1. <strong class="text-white">$2</strong> — $3</div>')
    .replace(/^(\d+)\. (.+)$/gm, '<div class="ml-4 mb-1">$1. $2</div>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-gray-900 px-1 rounded text-yellow-300 text-xs">$1</code>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p class="mb-2">')
    .replace(/\n/g, '<br/>');

  return html;
};

export default function Diagnost({ onBack }: { onBack: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    axios.get(`${API}/diagnost/status`)
      .then(r => setSystemStatus(r.data))
      .catch(() => {});
  }, []);

  const toggleTools = (idx: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await axios.post(`${API}/diagnost/chat`, {
        message: userMessage.content,
        history,
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: res.data.message,
        toolCalls: res.data.toolCalls,
        toolResults: res.data.toolResults,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (e: any) {
      const errorMessage: Message = {
        role: 'assistant',
        content: `Ошибка: ${e.response?.data?.error || e.message}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const quickDiagnost = async () => {
    setInput('Проведи диагностику Supply: проверь здоровье сервера, БД, количество SKU, рецепты и нераспознанные позиции.');
    setTimeout(() => sendMessage(), 100);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white transition">← Назад</button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-white">🩺 Доктор Саппи — диагностика Supply</h1>
          <p className="text-xs text-gray-500">AI-диагност приложения Supply KLM</p>
        </div>
        {systemStatus && (
          <div className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded">
            Сервер: {systemStatus.checks?.check_health?.status || 'проверка...'}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <div className="text-4xl mb-4">🩺</div>
            <h2 className="text-xl font-semibold text-gray-300 mb-2">Доктор Саппи</h2>
            <p className="text-sm mb-6">Задайте вопрос о работе Supply KLM</p>
            <button
              onClick={quickDiagnost}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm transition"
            >
              🔍 Провести диагностику
            </button>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-200'
            }`}>
              {/* Main message content — strip TOOL markers + render markdown */}
              {msg.role === 'assistant' ? (
                <div className="whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(stripToolCalls(msg.content)) }} />
              ) : (
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              )}

              {/* Collapsible tool details */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-3 pt-2">
                  <button
                    onClick={() => toggleTools(i)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition flex items-center gap-1"
                  >
                    <span className={`transition-transform ${expandedTools.has(i) ? 'rotate-90' : ''}`}>▶</span>
                    Подробнее о диагностике ({msg.toolCalls.length} инстр.)
                  </button>

                  {expandedTools.has(i) && (
                    <div className="mt-2 space-y-1">
                      {/* Tool calls */}
                      <div className="text-xs text-gray-400 mb-1">Инструменты:</div>
                      {msg.toolCalls.map((tc, j) => (
                        <div key={j} className="text-xs bg-gray-900 rounded px-2 py-1">
                          <span className="text-yellow-400">🔧 {tc.tool}</span>
                          {tc.args.length > 0 && <span className="text-gray-500">({tc.args.join(', ')})</span>}
                        </div>
                      ))}

                      {/* Tool results */}
                      {msg.toolResults && Object.keys(msg.toolResults).length > 0 && (
                        <>
                          <div className="text-xs text-gray-400 mt-2 mb-1">Результаты:</div>
                          {Object.entries(msg.toolResults).map(([key, val]) => (
                            <div key={key} className="text-xs bg-gray-900 rounded px-2 py-1">
                              <span className="text-green-400">{key}:</span>{' '}
                              <span className="text-gray-300">{JSON.stringify(val).slice(0, 300)}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="text-xs text-gray-500 mt-2">
                {msg.timestamp.toLocaleTimeString('ru-RU')}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full"></div>
                <span className="text-sm text-gray-400">Доктор Саппи думает...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-gray-900 border-t border-gray-800 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Задайте вопрос о Supply KLM..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2 rounded-lg text-sm transition"
          >
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}
