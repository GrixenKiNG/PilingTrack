'use client';

import { useState } from 'react';
import { BellRing, Building2, Database, LayoutGrid, LayoutTemplate, Save, Settings2, ShieldCheck, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { usePilingStore } from '@/lib/store';
import { AnalyticsDashboardLayoutEditor } from '@/components/piling/analytics-dashboard/kpi-widgets';
import { MainDashboardLayoutEditor } from '@/components/piling/main-dashboard/dashboard-layout';

type NotificationKey = 'dailyReport' | 'equipmentDowntime' | 'safetyIncident' | 'shiftEnd';

const notificationLabels: Record<NotificationKey, { title: string; description: string }> = {
  dailyReport: { title: 'Ежедневные отчёты', description: 'Напоминание о незаполненных отчётах по сменам.' },
  equipmentDowntime: { title: 'Простой оборудования', description: 'Сигнал, когда установка простаивает дольше установленного времени.' },
  safetyIncident: { title: 'Нарушения безопасности', description: 'Уведомления о критичных замечаниях на объекте.' },
  shiftEnd: { title: 'Окончание смены', description: 'Сводка результатов и незавершённых задач.' },
};

function Toggle({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} data-state={checked ? 'checked' : 'unchecked'} onClick={onClick}
      className={`relative h-6 w-11 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${checked ? 'bg-orange-500' : 'bg-slate-200'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function WorkspaceSettings() {
  const [notifications, setNotifications] = useState<Record<NotificationKey, boolean>>({ dailyReport: true, equipmentDowntime: true, safetyIncident: true, shiftEnd: false });
  const [activeTab, setActiveTab] = useState<'workspace' | 'roles' | 'notifications' | 'template'>('workspace');
  const toggleNotification = (key: NotificationKey) => setNotifications((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div data-testid="operations-settings" className="space-y-6 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-bold text-slate-950"><Settings2 className="h-5 w-5 text-orange-500" />Настройки</h1><p className="mt-1 text-sm text-slate-500">Управление рабочим пространством, доступом и правилами уведомлений.</p></div><Button onClick={() => toast.success('Настройки рабочего пространства сохранены')}><Save className="mr-2 h-4 w-4" />Сохранить изменения</Button></header>

      <nav aria-label="Разделы настроек" className="flex gap-5 overflow-x-auto border-b border-slate-200 text-sm font-medium">{([{ id: 'workspace', label: 'Рабочее пространство' }, { id: 'roles', label: 'Пользователи и роли' }, { id: 'notifications', label: 'Уведомления' }, { id: 'template', label: 'Шаблоны плиток' }] as const).map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={activeTab === tab.id ? 'border-b-2 border-lime-500 pb-3 text-slate-950' : 'pb-3 text-slate-500'}>{tab.label}</button>)}</nav>

      {activeTab === 'template' ? <TemplatesTab /> : <>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-orange-500" />Рабочее пространство</CardTitle><CardDescription>Основные параметры компании и единиц измерения.</CardDescription></CardHeader><CardContent className="space-y-4"><SettingValue label="Название компании" value="PilingTrack Demo" /><SettingValue label="Часовой пояс" value="UTC+3 — Москва" /><SettingValue label="Единицы измерения" value="Метры, часы, рубли" /><SettingValue label="Язык интерфейса" value="Русский" /></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><UsersRound className="h-4 w-4 text-orange-500" />Пользователи и роли</CardTitle><CardDescription>Кто управляет объектами, установками и отчётами.</CardDescription></CardHeader><CardContent className="space-y-3"><RoleRow role="Администратор" count="12 пользователей" description="Полный доступ к настройкам и справочникам." /><RoleRow role="Руководитель проекта" count="8 пользователей" description="Контроль объектов, отчётов и аналитики." /><RoleRow role="Производитель работ" count="15 пользователей" description="Смена, задачи бригад и оперативные данные." /><Button variant="outline" className="w-full justify-start" asChild><a href="/admin/users"><ShieldCheck className="mr-2 h-4 w-4" />Управление ролями</a></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4 text-orange-500" />Уведомления</CardTitle><CardDescription>Выберите события, о которых система сообщает команде.</CardDescription></CardHeader><CardContent className="space-y-4">{(Object.keys(notificationLabels) as NotificationKey[]).map((key) => { const item = notificationLabels[key]; return <div key={key} className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-800">{item.title}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{item.description}</p></div><Toggle checked={notifications[key]} label={item.title} onClick={() => toggleNotification(key)} /></div>; })}</CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-orange-500" />Интеграции и резервное копирование</CardTitle><CardDescription>Состояние подключений и защита операционных данных.</CardDescription></CardHeader><CardContent className="space-y-3"><StatusRow label="API-доступ" value="Настроен" positive /><StatusRow label="1С:ERP" value="Подключено" positive /><StatusRow label="BI-экспорт" value="Настроен" positive /><Separator /><StatusRow label="Последнее резервное копирование" value="Сегодня, 02:00" /><Button variant="outline" className="w-full justify-start"><Database className="mr-2 h-4 w-4" />Создать резервную копию</Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><LayoutTemplate className="h-4 w-4 text-orange-500" />Шаблон плиток установок</CardTitle><CardDescription>Единая структура карточек на экране мониторинга.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-800">Единый шаблон оборудования</p><p className="mt-1 text-xs leading-5 text-slate-500">Размер, сетка, границы блоков, текст и фото каждой установки редактируются в модуле мониторинга.</p></div><Button variant="outline" className="w-full justify-start" asChild><a href="/monitoring?design=1"><LayoutTemplate className="mr-2 h-4 w-4" />Открыть редактор шаблона</a></Button></CardContent></Card>
      </div>
      </>}
    </div>
  );
}

function TemplatesTab() {
  const isAdmin = usePilingStore((state) => state.currentUser?.role) === 'ADMIN';
  const [surface, setSurface] = useState<'analytics' | 'main'>('analytics');
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><LayoutGrid className="h-4 w-4 text-orange-500" />Редактирование рабочего пространства</CardTitle>
          <CardDescription>Состав, порядок и размер плиток на дашбордах.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
            {([['analytics', 'Дашборд аналитики'], ['main', 'Главный дашборд']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setSurface(id)}
                className={surface === id ? 'rounded-md bg-white px-3 py-1.5 font-medium text-slate-900 shadow-sm' : 'px-3 py-1.5 text-slate-500 hover:text-slate-700'}>
                {label}
              </button>
            ))}
          </div>
          {isAdmin
            ? (surface === 'analytics' ? <AnalyticsDashboardLayoutEditor /> : <MainDashboardLayoutEditor />)
            : <p className="text-sm text-slate-500">Настройка раскладки доступна администратору.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><LayoutTemplate className="h-4 w-4 text-orange-500" />Плитки установок (мониторинг)</CardTitle><CardDescription>Блоки, размер и фото карточки на экране мониторинга.</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full justify-start" asChild><a href="/monitoring?design=1"><LayoutTemplate className="mr-2 h-4 w-4" />Открыть редактор плиток</a></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><LayoutGrid className="h-4 w-4 text-orange-500" />Карточки оборудования</CardTitle><CardDescription>Индивидуальная раскладка карточек в модуле «Оборудование».</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full justify-start" asChild><a href="/admin/equipment"><LayoutGrid className="mr-2 h-4 w-4" />Открыть «Конструктор»</a></Button></CardContent></Card>
      </div>
    </div>
  );
}

function SettingValue({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-medium text-slate-800">{value}</p></div>; }
function RoleRow({ role, count, description }: { role: string; count: string; description: string }) { return <div className="rounded-lg border border-slate-100 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-800">{role}</p><span className="text-xs text-slate-500">{count}</span></div><p className="mt-1 text-xs text-slate-500">{description}</p></div>; }
function StatusRow({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) { return <div className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-600">{label}</span><span className={positive ? 'font-medium text-emerald-600' : 'font-medium text-slate-800'}>{value}</span></div>; }
