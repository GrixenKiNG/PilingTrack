'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Building2, Database, LayoutGrid, LayoutTemplate, Save, Send, Settings2, ShieldCheck, UsersRound } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePilingStore } from '@/lib/store';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  NOTIFICATION_KEYS,
  type WorkspaceSettings as WorkspaceSettingsData,
} from '@/modules/settings/domain/settings';
import { AnalyticsDashboardLayoutEditor } from '@/components/piling/analytics-dashboard/kpi-widgets';
import { MainDashboardLayoutEditor } from '@/components/piling/main-dashboard/dashboard-layout';

type Tab = 'workspace' | 'roles' | 'notifications' | 'template';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  DISPATCHER: 'Диспетчер',
  OPERATOR: 'Оператор',
  ASSISTANT: 'Помощник',
};
const ROLE_ORDER = ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT'];

function Toggle({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-orange-500' : 'bg-slate-200'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Field({ label, value, onChange, disabled, placeholder }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

export function WorkspaceSettings() {
  const isAdmin = usePilingStore((state) => state.currentUser?.role) === 'ADMIN';
  const [activeTab, setActiveTab] = useState<Tab>('workspace');
  const [settings, setSettings] = useState<WorkspaceSettingsData>(DEFAULT_WORKSPACE_SETTINGS);
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<WorkspaceSettingsData | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await authFetch('/api/settings');
        if (res.ok && active) setSettings(await res.json());
      } catch { /* keep defaults */ }
    })();
    void (async () => {
      const counts: Record<string, number> = {};
      let cursor: string | null = null;
      for (let i = 0; i < 50; i++) {
        const url: string = `/api/users?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res: Response | null = await authFetch(url).catch(() => null);
        if (!res || !res.ok) break;
        const body: { users?: Array<{ role: string }>; nextCursor?: string | null } = await res.json();
        for (const u of (body.users ?? [])) counts[u.role] = (counts[u.role] ?? 0) + 1;
        cursor = body.nextCursor ?? null;
        if (!cursor) break;
      }
      if (active) setRoleCounts(counts);
    })();
    return () => { active = false; };
  }, []);

  const save = useCallback(async (next: WorkspaceSettingsData) => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!res.ok) { toast.error(res.status === 403 ? 'Только администратор может сохранять настройки' : 'Не удалось сохранить'); return; }
      setSettings(await res.json());
      toast.success('Настройки сохранены');
    } finally {
      setSaving(false);
    }
  }, [isAdmin]);

  const setField = (patch: Partial<WorkspaceSettingsData>) => setSettings((s) => ({ ...s, ...patch }));
  const toggleNotification = (key: string) => {
    const next = { ...settings, notifications: { ...settings.notifications, [key]: !settings.notifications[key] } };
    setSettings(next);
    void save(next);
  };

  return (
    <div data-testid="operations-settings" className="space-y-6 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-950"><Settings2 className="h-5 w-5 text-orange-500" />Настройки</h1>
          <p className="mt-1 text-sm text-slate-500">Управление рабочим пространством, доступом и правилами уведомлений.</p>
        </div>
      </header>

      <nav aria-label="Разделы настроек" className="flex gap-5 overflow-x-auto border-b border-slate-200 text-sm font-medium">
        {([{ id: 'workspace', label: 'Рабочее пространство' }, { id: 'roles', label: 'Пользователи и роли' }, { id: 'notifications', label: 'Уведомления' }, { id: 'template', label: 'Шаблоны плиток' }] as const).map((tab) => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={activeTab === tab.id ? 'border-b-2 border-lime-500 pb-3 text-slate-950' : 'pb-3 text-slate-500'}>{tab.label}</button>
        ))}
      </nav>

      {activeTab === 'workspace' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Рабочее пространство — просмотр + Редактировать */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-orange-500" />Рабочее пространство</CardTitle>
              {isAdmin && !editing && (
                <Button variant="outline" size="sm" onClick={() => { setSnapshot(settings); setEditing(true); }}>Редактировать</Button>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Название компании" value={settings.companyName} disabled={!isAdmin} placeholder="ООО «Орион»" onChange={(v) => setField({ companyName: v })} />
                    <Field label="ИНН" value={settings.inn} disabled={!isAdmin} placeholder="7802XXXXXX" onChange={(v) => setField({ inn: v })} />
                    <Field label="Часовой пояс" value={settings.timezone} disabled={!isAdmin} onChange={(v) => setField({ timezone: v })} />
                    <Field label="Формат даты" value={settings.dateFormat} disabled={!isAdmin} onChange={(v) => setField({ dateFormat: v })} />
                    <label className="block">
                      <span className="text-xs text-slate-500">Единицы измерения</span>
                      <select value={settings.units} disabled={!isAdmin} onChange={(e) => setField({ units: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50">
                        <option value="metric">Метрическая (м, ч)</option>
                        <option value="imperial">Имперская (ft)</option>
                      </select>
                    </label>
                    <Field label="Валюта" value={settings.currency} disabled={!isAdmin} onChange={(v) => setField({ currency: v })} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={async () => { await save(settings); setEditing(false); }} disabled={saving}><Save className="mr-2 h-4 w-4" />Сохранить</Button>
                    <Button size="sm" variant="outline" onClick={() => { if (snapshot) setSettings(snapshot); setEditing(false); }}>Отмена</Button>
                  </div>
                </div>
              ) : (
                <dl className="divide-y divide-slate-100 text-sm">
                  <Row label="Название компании" value={settings.companyName || '—'} />
                  <Row label="ИНН" value={settings.inn || '—'} />
                  <Row label="Часовой пояс" value={settings.timezone || '—'} />
                  <Row label="Формат даты" value={settings.dateFormat || '—'} />
                  <Row label="Единицы измерения" value={settings.units === 'imperial' ? 'Имперская (ft)' : 'Метрическая система'} />
                  <Row label="Валюта" value={settings.currency || '—'} />
                </dl>
              )}
            </CardContent>
          </Card>

          {/* Доступ по ролям — реальные 4 роли */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-orange-500" />Доступ по ролям</CardTitle>
              <Button variant="outline" size="sm" asChild><a href="/admin/users">Управление ролями</a></Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-xs text-slate-500"><span>Роль</span><span>Пользователей</span></div>
              {ROLE_ORDER.map((role) => (
                <div key={role} className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm">
                  <span className="text-slate-800">{ROLE_LABELS[role] ?? role}</span>
                  <span className="font-medium text-slate-700">{roleCounts[role] ?? 0}</span>
                </div>
              ))}
              <a href="/admin/users" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline">Все роли и права доступа →</a>
            </CardContent>
          </Card>

          {/* Уведомления */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4 text-orange-500" />Уведомления</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {NOTIFICATION_KEYS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-800">{label}</p>
                  <Toggle checked={settings.notifications[key] ?? false} label={label} disabled={!isAdmin} onClick={() => toggleNotification(key)} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Интеграции и резервное копирование — честно */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-orange-500" />Интеграции и резервное копирование</CardTitle><CardDescription>Подключения и защита данных.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-600">Telegram-бот</span><a href="/admin/telegram" className="inline-flex items-center gap-1.5 font-medium text-blue-600 hover:underline"><Send className="h-3.5 w-3.5" />Настроить</a></div>
              <p className="text-xs leading-5 text-slate-500">Резервное копирование выполняется на сервере по расписанию (off-site). Управление — на стороне инфраструктуры.</p>
            </CardContent>
          </Card>

          {/* Шаблоны плиток — на всю ширину */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><LayoutGrid className="h-4 w-4 text-orange-500" />Шаблоны плиток</CardTitle>
                <CardDescription>Состав, порядок и размер плиток на дашбордах, мониторинге и в оборудовании.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setActiveTab('template')}>Открыть редактор</Button>
            </CardHeader>
          </Card>
        </div>
      )}

      {activeTab === 'roles' && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UsersRound className="h-4 w-4 text-orange-500" />Пользователи и роли</CardTitle><CardDescription>Фактическое число пользователей по ролям.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {ROLE_ORDER.map((role) => (
              <div key={role} className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-sm">
                <span className="font-medium text-slate-800">{ROLE_LABELS[role] ?? role}</span>
                <span className="text-slate-500">{roleCounts[role] ?? 0}</span>
              </div>
            ))}
            <Button variant="outline" className="w-full justify-start" asChild><a href="/admin/users"><ShieldCheck className="mr-2 h-4 w-4" />Управление ролями</a></Button>
          </CardContent>
        </Card>
      )}

      {activeTab === 'notifications' && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4 text-orange-500" />Уведомления</CardTitle><CardDescription>События, о которых система сообщает команде.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {NOTIFICATION_KEYS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-800">{label}</p>
                <Toggle checked={settings.notifications[key] ?? false} label={label} disabled={!isAdmin} onClick={() => toggleNotification(key)} />
              </div>
            ))}
            {!isAdmin && <p className="text-xs text-slate-500">Изменение доступно администратору.</p>}
          </CardContent>
        </Card>
      )}

      {activeTab === 'template' && <TemplatesTab />}
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
