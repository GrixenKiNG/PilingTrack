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
import { AdminTelegram } from '@/components/piling/admin-telegram';
import { AdminDlq } from '@/components/piling/admin-dlq';

type Tab = 'workspace' | 'roles' | 'notifications' | 'template' | 'telegram' | 'dlq';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  DISPATCHER: 'Диспетчер',
  OPERATOR: 'Оператор',
  ASSISTANT: 'Помощник',
};
const ROLE_ORDER = ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT'];

function Toggle({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    // Дорожка 44px, кружок 20px, поля по 2px с каждой стороны:
    // выключено — left 2px, включено — +20px (2..42). `left-0.5` обязателен:
    // без него кружок вставал в статическую позицию, а <button> центрирует
    // содержимое, поэтому отсчёт шёл от середины и включённый кружок вылезал
    // на 8px за правый край дорожки.
    <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-signal' : 'bg-slate-200'}`}>
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function Field({ label, value, onChange, disabled, placeholder }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground disabled:bg-muted disabled:text-muted-foreground focus:border-info focus:outline-none focus:ring-2 focus:ring-info/30/20"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
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
      if (!res.ok) {
        toast.error(res.status === 403
          ? 'Только администратор может изменять настройки рабочего пространства.'
          : 'Настройки не сохранены. Повторите попытку.');
        return;
      }
      setSettings(await res.json());
      toast.success('Настройки сохранены');
    } catch {
      toast.error('Настройки не сохранены. Проверьте подключение и повторите попытку.');
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
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><Settings2 className="h-5 w-5 text-signal-strong" />Настройки</h1>
          <p className="mt-1 text-sm text-muted-foreground">Управление рабочим пространством, доступом и правилами уведомлений.</p>
        </div>
      </header>

      <nav aria-label="Разделы настроек" className="flex gap-5 overflow-x-auto border-b border-border text-sm font-medium">
        {([
          { id: 'workspace', label: 'Рабочее пространство' },
          { id: 'roles', label: 'Пользователи и роли' },
          { id: 'notifications', label: 'Уведомления' },
          { id: 'template', label: 'Шаблоны плиток' },
          // Telegram и DLQ — операционное обслуживание, только администратор.
          ...(isAdmin ? [{ id: 'telegram', label: 'Telegram' }, { id: 'dlq', label: 'Очередь (DLQ)' }] as const : []),
        ] as const).map((tab) => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`shrink-0 ${activeTab === tab.id ? 'border-b-2 border-lime-500 pb-3 text-foreground' : 'pb-3 text-muted-foreground'}`}>{tab.label}</button>
        ))}
      </nav>

      {activeTab === 'workspace' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Рабочее пространство — просмотр + Редактировать */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-signal-strong" />Рабочее пространство</CardTitle>
              {isAdmin && !editing && (
                <Button variant="outline" size="sm" onClick={() => { setSnapshot(settings); setEditing(true); }}>Редактировать</Button>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="space-y-4">
                  {/* Только то, что приложение действительно читает. ИНН,
                      формат даты, единицы и валюта сохранялись и не влияли ни
                      на что: даты всегда ru-RU, единицы метрические, валюта
                      подписана «₽» в разметке. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Название компании" value={settings.companyName} disabled={!isAdmin} placeholder="ООО «Орион»" onChange={(v) => setField({ companyName: v })} />
                    <Field label="Часовой пояс" value={settings.timezone} disabled={!isAdmin} placeholder="Europe/Moscow" onChange={(v) => setField({ timezone: v })} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={async () => { await save(settings); setEditing(false); }} disabled={saving}><Save className="mr-2 h-4 w-4" />Сохранить</Button>
                    <Button size="sm" variant="outline" onClick={() => { if (snapshot) setSettings(snapshot); setEditing(false); }}>Отмена</Button>
                  </div>
                </div>
              ) : (
                <dl className="divide-y divide-border text-sm">
                  <Row label="Название компании" value={settings.companyName || '—'} />
                  <Row label="Часовой пояс" value={settings.timezone || '—'} />
                </dl>
              )}
            </CardContent>
          </Card>

          {/* Доступ по ролям — реальные 4 роли */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-signal-strong" />Доступ по ролям</CardTitle>
              <Button variant="outline" size="sm" asChild><a href="/admin/users">Управление ролями</a></Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between border-b border-border pb-2 text-xs text-muted-foreground"><span>Роль</span><span>Пользователей</span></div>
              {ROLE_ORDER.map((role) => (
                <div key={role} className="flex items-center justify-between border-b border-border py-2.5 text-sm">
                  <span className="text-foreground">{ROLE_LABELS[role] ?? role}</span>
                  <span className="font-medium text-foreground">{roleCounts[role] ?? 0}</span>
                </div>
              ))}
              <a href="/admin/users" className="mt-3 inline-block text-sm font-medium text-info-strong hover:underline">Все роли и права доступа →</a>
            </CardContent>
          </Card>

          {/* Уведомления */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4 text-signal-strong" />Уведомления</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {NOTIFICATION_KEYS.map(({ key, label, implemented }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    {/* Правило без отправителя: признак сохранится, но слать
                        его некому. Молчать об этом — обманывать администратора. */}
                    {!implemented && <p className="text-xs text-muted-foreground">Отправитель не реализован</p>}
                  </div>
                  <Toggle checked={settings.notifications[key] ?? false} label={label} disabled={!isAdmin} onClick={() => toggleNotification(key)} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Интеграции и резервное копирование — честно */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-signal-strong" />Интеграции и резервное копирование</CardTitle><CardDescription>Подключения и защита данных.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">Telegram-бот</span>{isAdmin ? <button type="button" onClick={() => setActiveTab('telegram')} className="inline-flex items-center gap-1.5 font-medium text-info-strong hover:underline"><Send className="h-3.5 w-3.5" />Настроить</button> : <span className="text-muted-foreground">только администратор</span>}</div>
              {isAdmin && <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">Очередь сообщений (DLQ)</span><button type="button" onClick={() => setActiveTab('dlq')} className="inline-flex items-center gap-1.5 font-medium text-info-strong hover:underline"><Database className="h-3.5 w-3.5" />Открыть</button></div>}
              <p className="text-xs leading-5 text-muted-foreground">Резервное копирование выполняется на сервере по расписанию (off-site). Управление — на стороне инфраструктуры.</p>
            </CardContent>
          </Card>

          {/* Шаблоны плиток — на всю ширину */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><LayoutGrid className="h-4 w-4 text-signal-strong" />Шаблоны плиток</CardTitle>
                <CardDescription>Состав, порядок и размер плиток на дашбордах, мониторинге и в оборудовании.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setActiveTab('template')}>Открыть редактор</Button>
            </CardHeader>
          </Card>
        </div>
      )}

      {activeTab === 'roles' && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UsersRound className="h-4 w-4 text-signal-strong" />Пользователи и роли</CardTitle><CardDescription>Текущее количество пользователей с каждой ролью.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {ROLE_ORDER.map((role) => (
              <div key={role} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <span className="font-medium text-foreground">{ROLE_LABELS[role] ?? role}</span>
                <span className="text-muted-foreground">{roleCounts[role] ?? 0}</span>
              </div>
            ))}
            <Button variant="outline" className="w-full justify-start" asChild><a href="/admin/users"><ShieldCheck className="mr-2 h-4 w-4" />Управление ролями</a></Button>
          </CardContent>
        </Card>
      )}

      {activeTab === 'notifications' && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4 text-signal-strong" />Уведомления</CardTitle><CardDescription>События, о которых система сообщает команде.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {NOTIFICATION_KEYS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <Toggle checked={settings.notifications[key] ?? false} label={label} disabled={!isAdmin} onClick={() => toggleNotification(key)} />
              </div>
            ))}
            {!isAdmin && <p className="text-xs text-muted-foreground">Только администратор может изменять правила уведомлений.</p>}
          </CardContent>
        </Card>
      )}

      {activeTab === 'template' && <TemplatesTab />}

      {activeTab === 'telegram' && (isAdmin
        ? <AdminTelegram />
        : <p className="text-sm text-muted-foreground">Только администратор может настраивать Telegram-бота.</p>)}

      {activeTab === 'dlq' && (isAdmin
        ? <AdminDlq />
        : <p className="text-sm text-muted-foreground">Только администратор может просматривать очередь недоставленных сообщений.</p>)}
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
          <CardTitle className="flex items-center gap-2 text-base"><LayoutGrid className="h-4 w-4 text-signal-strong" />Раскладка дашбордов</CardTitle>
          <CardDescription>Выберите дашборд, затем настройте состав, порядок и размер его плиток.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1 text-sm">
            {([['analytics', 'Дашборд аналитики'], ['main', 'Главный дашборд']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setSurface(id)}
                className={surface === id ? 'rounded-md bg-card px-3 py-1.5 font-medium text-foreground shadow-sm' : 'px-3 py-1.5 text-muted-foreground hover:text-foreground'}>
                {label}
              </button>
            ))}
          </div>
          {isAdmin
            ? (surface === 'analytics' ? <AnalyticsDashboardLayoutEditor /> : <MainDashboardLayoutEditor />)
            : <p className="text-sm text-muted-foreground">Настройка раскладки доступна администратору.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><LayoutTemplate className="h-4 w-4 text-signal-strong" />Плитки установок (мониторинг)</CardTitle><CardDescription>Блоки, размер и фото карточки на экране мониторинга.</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full justify-start" asChild><a href="/monitoring?design=1"><LayoutTemplate className="mr-2 h-4 w-4" />Открыть редактор плиток</a></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><LayoutGrid className="h-4 w-4 text-signal-strong" />Карточки оборудования</CardTitle><CardDescription>Индивидуальная раскладка карточек в модуле «Оборудование».</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full justify-start" asChild><a href="/admin/equipment"><LayoutGrid className="mr-2 h-4 w-4" />Открыть «Конструктор»</a></Button></CardContent></Card>
      </div>
    </div>
  );
}
