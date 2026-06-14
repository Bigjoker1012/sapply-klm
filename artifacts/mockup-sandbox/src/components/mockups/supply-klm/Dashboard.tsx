import React from "react";
import {
  LayoutDashboard,
  CloudDownload,
  ScrollText,
  BookOpen,
  ListOrdered,
  History,
  Settings,
  Search,
  Bell,
  AlertTriangle,
  ArrowLeftRight,
  ShoppingCart,
  Truck,
  Calendar,
  CheckCircle2,
  Clock,
  Boxes,
  Factory,
  PackageOpen,
  ChevronDown,
  AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Dashboard() {
  return (
    <div className="flex h-[1800px] w-[1440px] flex-col bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar */}
        <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0">
          <div className="h-14 flex items-center px-4 border-b border-slate-800">
            <div className="flex items-center gap-2 text-teal-400">
              <Boxes className="size-6" />
              <div>
                <div className="font-bold text-slate-100 text-sm leading-tight tracking-tight">Sapply KLM</div>
                <div className="text-[10px] text-slate-400 leading-tight">Полоцкий КХП</div>
              </div>
            </div>
          </div>
          
          <nav className="flex-1 py-4 space-y-1 px-2">
            {[
              { icon: LayoutDashboard, label: "Дашборд", active: true },
              { icon: CloudDownload, label: "Загрузки данных" },
              { icon: ScrollText, label: "Рецепты" },
              { icon: BookOpen, label: "Каталог сырья" },
              { icon: ListOrdered, label: "Очередь обработки" },
              { icon: History, label: "Журнал событий" },
              { icon: Settings, label: "Настройки" },
            ].map((item, idx) => (
              <button
                key={idx}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                  item.active 
                    ? "bg-teal-500/10 text-teal-400 font-medium" 
                    : "hover:bg-slate-800 hover:text-slate-100"
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </button>
            ))}
          </nav>
          
          <div className="p-4 border-t border-slate-800 flex items-center gap-3">
            <Avatar className="size-8 border border-slate-700">
              <AvatarFallback className="bg-slate-800 text-slate-300 text-xs">АИ</AvatarFallback>
            </Avatar>
            <div className="flex flex-col text-left">
              <span className="text-sm font-medium text-slate-200">Иванов А.С.</span>
              <span className="text-xs text-slate-500">Снабженец</span>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          
          {/* Topbar */}
          <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-500">Площадка:</span>
                <button className="flex items-center gap-1 text-sm font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded">
                  Полоцк + Липковская <ChevronDown className="size-3 text-slate-500" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-500">Горизонт:</span>
                <div className="flex bg-slate-100 rounded p-0.5">
                  <button className="text-xs font-medium bg-white shadow-sm text-slate-900 px-3 py-1 rounded-sm">14 дней</button>
                  <button className="text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1 rounded-sm">30 дней</button>
                  <button className="text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1 rounded-sm">60 дней</button>
                </div>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-1.5 ml-2 border-l border-slate-200 pl-6">
                <Clock className="size-3.5" />
                обновлено 27.05.2026, 07:42
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <Input 
                  placeholder="Поиск по сырью (код или назв.)..." 
                  className="h-8 pl-9 bg-slate-50 border-slate-200 text-sm focus-visible:ring-teal-500"
                />
              </div>
              <button className="relative p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                <Bell className="size-5" />
                <span className="absolute top-1 right-1 flex size-3 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-white">4</span>
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-auto p-6 flex gap-6">
            
            <div className="flex-1 flex flex-col gap-6">
              {/* KPI Strip */}
              <div className="grid grid-cols-6 gap-3 shrink-0">
                <div className="bg-red-50 border border-red-100 rounded-lg p-3 shadow-sm flex flex-col">
                  <div className="text-red-800 text-xs font-medium mb-1 flex items-center gap-1.5">
                    <AlertTriangle className="size-3.5" /> Срочно закупить
                  </div>
                  <div className="text-2xl font-bold font-mono text-red-600 mt-auto">7</div>
                  <div className="text-xs text-red-700/70">позиций</div>
                </div>
                <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 shadow-sm flex flex-col">
                  <div className="text-orange-800 text-xs font-medium mb-1 flex items-center gap-1.5">
                    <ShoppingCart className="size-3.5" /> К закупке (14 дн.)
                  </div>
                  <div className="text-2xl font-bold font-mono text-orange-600 mt-auto">23</div>
                  <div className="text-xs text-orange-700/70">позиции</div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 shadow-sm flex flex-col">
                  <div className="text-blue-800 text-xs font-medium mb-1 flex items-center gap-1.5">
                    <ArrowLeftRight className="size-3.5" /> Можно перебросить
                  </div>
                  <div className="text-2xl font-bold font-mono text-blue-600 mt-auto">5</div>
                  <div className="text-xs text-blue-700/70">с Липковской</div>
                </div>
                <div className="bg-slate-100 border border-slate-200 rounded-lg p-3 shadow-sm flex flex-col">
                  <div className="text-slate-700 text-xs font-medium mb-1 flex items-center gap-1.5">
                    <Truck className="size-3.5" /> В пути
                  </div>
                  <div className="text-2xl font-bold font-mono text-slate-800 mt-auto">12</div>
                  <div className="text-xs text-slate-500">партий (бл. 2 дн)</div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 shadow-sm flex flex-col">
                  <div className="text-amber-800 text-xs font-medium mb-1 flex items-center gap-1.5">
                    <AlertCircle className="size-3.5" /> Истекает годность
                  </div>
                  <div className="text-2xl font-bold font-mono text-amber-600 mt-auto">4</div>
                  <div className="text-xs text-amber-700/70">партии (~1.8 т)</div>
                </div>
                <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 shadow-sm flex flex-col">
                  <div className="text-teal-800 text-xs font-medium mb-1 flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5" /> Покрытие плана
                  </div>
                  <div className="text-2xl font-bold font-mono text-teal-600 mt-auto">96%</div>
                  <div className="text-xs text-teal-700/70">на 14 дней</div>
                </div>
              </div>

              {/* Main Table */}
              <div className="bg-white border border-slate-200 shadow-sm rounded-xl flex-1 flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                    Матрица решений: Сырьё <Badge variant="secondary" className="font-mono text-xs font-normal">14 дней</Badge>
                  </h2>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs bg-white">Экспорт в Excel</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs bg-white"><Settings className="size-3.5 mr-1" /> Вид</Button>
                  </div>
                </div>
                
                <div className="overflow-auto flex-1">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="py-2.5 px-4 font-medium">Сырьё / Код</th>
                        <th className="py-2.5 px-3 font-medium">Категория</th>
                        <th className="py-2.5 px-3 font-medium text-right">Ср.расход<br/><span className="text-[10px] font-normal">кг/сут</span></th>
                        <th className="py-2.5 px-3 font-medium text-right text-teal-700 bg-teal-50/30">Остаток<br/><span className="text-[10px] font-normal">Полоцк, кг</span></th>
                        <th className="py-2.5 px-3 font-medium text-right text-blue-700 bg-blue-50/30">Остаток<br/><span className="text-[10px] font-normal">Липк., кг</span></th>
                        <th className="py-2.5 px-3 font-medium text-right">В пути<br/><span className="text-[10px] font-normal">кг (дни)</span></th>
                        <th className="py-2.5 px-3 font-medium text-right bg-slate-100/50">Потребность<br/><span className="text-[10px] font-normal">14 дн, кг</span></th>
                        <th className="py-2.5 px-3 font-medium text-right bg-slate-100/80">Ожидаемый<br/><span className="text-[10px] font-normal">остаток, кг</span></th>
                        <th className="py-2.5 px-4 font-medium text-center">Статус</th>
                        <th className="py-2.5 px-4 font-medium">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        { name: "Метионин DL 99%", code: "AA-MET-990", cat: "Аминокислоты", rate: 250, pol: 800, lip: 0, way: "0", req: 3500, exp: -2700, stat: "Срочно", action: "Заказать 3000" },
                        { name: "Холин хлорид 60%", code: "VT-CHL-600", cat: "Витамины", rate: 300, pol: 1000, lip: 0, way: "0", req: 4200, exp: -3200, stat: "Срочно", action: "Заказать 4000" },
                        { name: "Витамин A 1000", code: "VT-A-1000", cat: "Витамины", rate: 15, pol: 100, lip: 0, way: "0", req: 210, exp: -110, stat: "Срочно", action: "Заказать 200" },
                        
                        { name: "Лизин монохлоргидрат 98.5%", code: "AA-LYS-985", cat: "Аминокислоты", rate: 400, pol: 1200, lip: 5000, way: "0", req: 5600, exp: 600, stat: "Переброска", action: "Перебросить 4400" },
                        { name: "Оксид цинка", code: "MN-ZNO-002", cat: "Микроэлементы", rate: 80, pol: 800, lip: 500, way: "0", req: 1120, exp: -320, stat: "Переброска", action: "Перебросить 400" },
                        { name: "Монокальцийфосфат", code: "FL-MCP-001", cat: "Наполнители", rate: 500, pol: 2000, lip: 6000, way: "0", req: 7000, exp: -5000, stat: "Переброска", action: "Перебросить 6000" },
                        
                        { name: "Антиоксидант «Эндокс»", code: "AX-END-001", cat: "Антиоксиданты", rate: 40, pol: 600, lip: 200, way: "0", req: 560, exp: 40, stat: "К закупке", action: "Заказать 500" },
                        { name: "Триптофан 98%", code: "AA-TRP-980", cat: "Аминокислоты", rate: 30, pol: 250, lip: 0, way: "0", req: 420, exp: -170, stat: "К закупке", action: "Заказать 300" },
                        { name: "Биотин 2%", code: "VT-BIO-002", cat: "Витамины", rate: 5, pol: 60, lip: 0, way: "0", req: 70, exp: -10, stat: "К закупке", action: "Заказать 50" },
                        { name: "Селенит натрия", code: "MN-NNA-001", cat: "Микроэлементы", rate: 2, pol: 25, lip: 10, way: "0", req: 28, exp: 7, stat: "К закупке", action: "Заказать 20" },

                        { name: "Витамин E 50%", code: "VT-E-500", cat: "Витамины", rate: 50, pol: 150, lip: 0, way: "1000 (5 дн)", req: 700, exp: 450, stat: "В пути", action: "-" },
                        { name: "Сульфат железа", code: "MN-FES-001", cat: "Микроэлементы", rate: 20, pol: 400, lip: 100, way: "0", req: 280, exp: 120, stat: "На контроле", action: "-" },
                        { name: "Треонин 98.5%", code: "AA-THR-985", cat: "Аминокислоты", rate: 180, pol: 3000, lip: 2000, way: "0", req: 2520, exp: 480, stat: "Норма", action: "-" },
                        { name: "Известняковая мука", code: "FL-CAL-001", cat: "Наполнители", rate: 800, pol: 15000, lip: 0, way: "20000 (2 дн)", req: 11200, exp: 23800, stat: "Норма", action: "-" },
                      ].map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 leading-tight">{row.name}</div>
                            <div className="font-mono text-[11px] text-slate-500 mt-0.5">{row.code}</div>
                          </td>
                          <td className="py-3 px-3 text-slate-600">{row.cat}</td>
                          <td className="py-3 px-3 text-right font-mono text-slate-700">{row.rate}</td>
                          <td className="py-3 px-3 text-right font-mono font-medium text-teal-800 bg-teal-50/10">{row.pol.toLocaleString()}</td>
                          <td className="py-3 px-3 text-right font-mono font-medium text-blue-800 bg-blue-50/10">{row.lip.toLocaleString()}</td>
                          <td className="py-3 px-3 text-right font-mono text-slate-600">
                            {row.way !== "0" ? <span className="text-slate-800 font-medium bg-slate-100 px-1.5 py-0.5 rounded text-xs">{row.way}</span> : "-"}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-700 bg-slate-50/50">{row.req.toLocaleString()}</td>
                          <td className="py-3 px-3 text-right font-mono font-bold bg-slate-50/80">
                            <span className={row.exp < 0 ? "text-red-600" : "text-slate-800"}>
                              {row.exp > 0 ? "+" : ""}{row.exp.toLocaleString()}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {row.stat === "Срочно" && <Badge variant="destructive" className="bg-red-500 shadow-sm border-0">Срочно</Badge>}
                            {row.stat === "К закупке" && <Badge className="bg-orange-500 hover:bg-orange-600 text-white border-0 shadow-sm">К закупке</Badge>}
                            {row.stat === "Переброска" && <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200 shadow-none">Переброска</Badge>}
                            {row.stat === "В пути" && <Badge className="bg-slate-100 text-slate-800 border-slate-200 shadow-none">В пути</Badge>}
                            {row.stat === "На контроле" && <Badge className="bg-amber-100 text-amber-800 border-amber-200 shadow-none">На контроле</Badge>}
                            {row.stat === "Норма" && <Badge className="bg-teal-100 text-teal-800 border-teal-200 shadow-none">Норма</Badge>}
                          </td>
                          <td className="py-3 px-4">
                            {row.action.startsWith("Заказать") && (
                              <Button size="sm" className="h-7 px-3 text-xs w-full bg-teal-600 hover:bg-teal-700 text-white shadow-sm border-teal-700">
                                {row.action}
                              </Button>
                            )}
                            {row.action.startsWith("Перебросить") && (
                              <Button size="sm" variant="outline" className="h-7 px-3 text-xs w-full border-blue-300 text-blue-700 hover:bg-blue-50 shadow-sm">
                                {row.action}
                              </Button>
                            )}
                            {row.action === "-" && (
                              <span className="text-slate-300 flex justify-center w-full">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="w-80 flex flex-col gap-6 shrink-0">
              
              <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <h3 className="font-medium text-slate-800 flex items-center gap-2 text-sm">
                    <Calendar className="size-4 text-amber-500" />
                    Истекающий срок годности
                  </h3>
                  <Badge variant="outline" className="text-[10px] h-5 bg-amber-50 text-amber-700 border-amber-200">{"< 30 дней"}</Badge>
                </div>
                <div className="p-3 flex flex-col gap-3">
                  {[
                    { name: "Витамин E 50%", lot: "LOT-2025-1102", qty: "420", date: "14.06.2026", wh: "Полоцк", days: 18 },
                    { name: "Холин хлорид 60%", lot: "LOT-2025-0899", qty: "850", date: "22.06.2026", wh: "Полоцк", days: 26 },
                    { name: "Оксид марганца", lot: "MN-OM-442", qty: "150", date: "25.06.2026", wh: "Липковская", days: 29 },
                    { name: "Биотин 2%", lot: "VT-B-091", qty: "45", date: "28.06.2026", wh: "Полоцк", days: 32 },
                  ].map((lot, i) => (
                    <div key={i} className="flex flex-col gap-1 p-2 rounded-md border border-slate-100 bg-slate-50 hover:border-slate-200 transition-colors">
                      <div className="flex justify-between items-start">
                        <span className="font-medium text-sm text-slate-800 leading-tight">{lot.name}</span>
                        <span className="font-mono text-xs font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-sm">{lot.days} дн</span>
                      </div>
                      <div className="flex justify-between items-center text-xs mt-1">
                        <span className="font-mono text-slate-500">{lot.lot}</span>
                        <span className="font-mono font-medium text-slate-700">{lot.qty} кг</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1"><Factory className="size-3" /> {lot.wh}</span>
                        <span>до {lot.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden flex flex-col flex-1">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <h3 className="font-medium text-slate-800 flex items-center gap-2 text-sm">
                    <Truck className="size-4 text-slate-500" />
                    Ближайшие поступления
                  </h3>
                </div>
                <div className="p-3 flex flex-col gap-3 overflow-auto flex-1">
                  {[
                    { supp: "Адиссео", item: "Метионин DL 99%", qty: "20 т", date: "29.05", status: "В пути", via: "Авто" },
                    { supp: "БАСФ", item: "Витамин A 1000", qty: "5 т", date: "30.05", status: "Растаможка", via: "Авто" },
                    { supp: "Эвоник", item: "Треонин 98.5%", qty: "40 т", date: "02.06", status: "Подтверждено", via: "Ж/Д" },
                    { supp: "КемИн", item: "Антиоксидант", qty: "2 т", date: "05.06", status: "На складе пост.", via: "Авто" },
                    { supp: "Витасоль", item: "Премикс базовый", qty: "10 т", date: "08.06", status: "Подтверждено", via: "Авто" },
                    { supp: "БиоХим", item: "Лизин моно.", qty: "60 т", date: "12.06", status: "На складе пост.", via: "Ж/Д" },
                  ].map((ship, i) => (
                    <div key={i} className="flex flex-col gap-1.5 p-2.5 rounded-md border border-slate-100 hover:bg-slate-50 transition-colors">
                      <div className="flex justify-between items-start">
                        <span className="font-semibold text-xs text-slate-800 uppercase tracking-wider">{ship.supp}</span>
                        <span className="font-mono text-xs font-medium text-slate-700">{ship.date}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-700 truncate mr-2" title={ship.item}>{ship.item}</span>
                        <span className="font-mono font-medium text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-xs shrink-0">{ship.qty}</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] mt-1">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded-sm font-medium",
                          ship.status === "В пути" ? "bg-blue-100 text-blue-700" :
                          ship.status === "Растаможка" ? "bg-amber-100 text-amber-700" :
                          "bg-slate-100 text-slate-600"
                        )}>
                          {ship.status}
                        </span>
                        <span className="text-slate-400 font-medium">{ship.via}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
          
          {/* Bottom Status Bar */}
          <footer className="h-8 border-t border-slate-200 bg-slate-100 flex items-center px-4 justify-between shrink-0">
            <div className="flex items-center gap-4 text-[11px] text-slate-500 font-mono">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="size-3 text-teal-500" /> Источник данных: Google Sheets</span>
              <span className="text-slate-300">|</span>
              <span>Последняя синхронизация: 2 мин назад</span>
              <span className="text-slate-300">|</span>
              <span className="flex items-center gap-1.5"><PackageOpen className="size-3" /> 4 фоновых задачи</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              v1.4.2-stable
            </div>
          </footer>

        </main>
      </div>
    </div>
  );
}
