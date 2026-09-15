'use client';

import {useCallback, useEffect, useState} from 'react';
import type {AssistantState, DocumentVerdict} from '@/modules/operator-mobile/contracts';
import {SLINGER_BRIEFING} from '@/modules/operator-mobile/contracts';
import {
  DEFECT_SEVERITY_FIELD_LABELS, DEFECT_STATUS_FIELD_LABELS, isAlarmingSeverity,
} from '@/modules/operator-mobile/domain/defect-labels';
import {formatRuDate} from '@/lib/format';
import {
  Banner, Button, Card, CardBody, Chip, Dock, Empty, Pair, PhoneShell, Row, Title,
  type DockItem, type Tone,
} from './v7-ui';
import {BriefingFlow, KnowledgeFlow} from './v7-identity';

/**
 * Рабочее место помощника машиниста в мобильной оболочке модуля оператора.
 *
 * ПОЧЕМУ ЭТО НЕ УРЕЗАННЫЙ ЭКРАН МАШИНИСТА. Смены у помощника нет: её ведёт
 * машинист, закреплённый за установкой. Помощнику принадлежит то, что относится
 * лично к нему — инструктаж по стропальным работам, проверка знаний и свои
 * допуски со сроками, — плюс открытые неисправности машин его бригад. Поэтому и
 * нижнее меню здесь своё: четыре раздела, без «Заданий» и «Смены».
 *
 * Оболочка и все элементы — те же, что у машиниста (`v7-ui`): человек, который
 * сегодня помощник, а завтра машинист, не должен заново узнавать приложение.
 */

type Tab = 'HOME' | 'SAFETY' | 'EQUIPMENT' | 'MORE';

const ASSISTANT_DOCK = [
  {key: 'HOME', label: 'Допуск', glyph: '⌂'},
  {key: 'SAFETY', label: 'ТБ', glyph: '⛨', mid: true},
  {key: 'EQUIPMENT', label: 'Техника', glyph: '▤'},
  {key: 'MORE', label: 'Ещё', glyph: '⋯'},
] as const satisfies readonly DockItem<Tab>[];

const TAB_TITLES: Record<Tab, string> = {
  HOME: 'Допуск к работам',
  SAFETY: 'Техника безопасности',
  EQUIPMENT: 'Техника бригад',
  MORE: 'Ещё',
};

const DOCUMENT_LABEL: Record<DocumentVerdict, string> = {
  VALID: 'Действует', EXPIRING: 'Истекает', EXPIRED: 'Просрочен', MISSING: 'Не заведён',
};

const DOCUMENT_TONE: Record<DocumentVerdict, Tone> = {
  VALID: 'ok', EXPIRING: 'warn', EXPIRED: 'bad', MISSING: 'bad',
};

type Detour = 'BRIEFING' | 'KNOWLEDGE';

async function readState(): Promise<AssistantState> {
  const response = await fetch('/api/assistant/state', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => null) as
    {data?: AssistantState; error?: string} | null;
  if (!response.ok) {
    const error = new Error(payload?.error ?? 'Сервер не ответил');
    (error as Error & {status?: number}).status = response.status;
    throw error;
  }
  return payload?.data as AssistantState;
}

async function sendCommand(command: unknown): Promise<void> {
  const response = await fetch('/api/assistant/command', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'same-origin',
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {error?: string} | null;
    throw new Error(payload?.error ?? 'Команда не прошла');
  }
}

export function AssistantV7App() {
  const [state, setState] = useState<AssistantState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [clock, setClock] = useState('');
  const [online, setOnline] = useState(true);
  const [tab, setTab] = useState<Tab>('HOME');
  const [detour, setDetour] = useState<Detour | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await readState());
      setLoadError(null);
      setSyncedAt(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    } catch (cause) {
      const status = (cause as Error & {status?: number}).status;
      if (status === 401) {
        window.location.href = '/login';
        return;
      }
      setLoadError(cause instanceof Error ? cause.message : 'Не удалось получить состояние');
    }
  }, []);

  useEffect(() => {
    // Небольшая задержка перед первым чтением не нужна, но состояние трогаем
    // только после await: setState прямо в теле эффекта даёт каскад перерисовок.
    void (async () => { await reload(); })();
  }, [reload]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const update = () => setOnline(globalThis.navigator?.onLine ?? true);
    update();
    globalThis.addEventListener?.('online', update);
    globalThis.addEventListener?.('offline', update);
    return () => {
      globalThis.removeEventListener?.('online', update);
      globalThis.removeEventListener?.('offline', update);
    };
  }, []);

  const run = useCallback(async (command: unknown) => {
    setBusy(true);
    setActionError(null);
    try {
      await sendCommand(command);
      await reload();
      setDetour(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Команда не прошла');
    } finally {
      setBusy(false);
    }
  }, [reload]);

  if (loadError) {
    return (
      <PhoneShell clock={clock} online={online} syncedAt={syncedAt} pending={0}>
        <div className="state">
          <h2>Состояние недоступно</h2>
          <p>{loadError}</p>
          <Button onClick={() => void reload()}>Повторить</Button>
        </div>
      </PhoneShell>
    );
  }

  if (!state) {
    return (
      <PhoneShell clock={clock} online={online} syncedAt={syncedAt} pending={0}>
        <div className="state"><h2>Загрузка</h2><p>Читаем ваши допуски</p></div>
      </PhoneShell>
    );
  }

  const messages = actionError
    ? <Banner tone="bad" title="Не отправлено" note={actionError} />
    : null;

  if (detour) {
    const back = () => { setDetour(null); setActionError(null); };
    return (
      <PhoneShell
        clock={clock} online={online} syncedAt={syncedAt} pending={0}
        back={detour === 'BRIEFING' ? 'Ознакомление' : 'Проверка знаний'} onBack={back}
      >
        {detour === 'BRIEFING' ? (
          <BriefingFlow
            busy={busy}
            version={state.briefing.version}
            text={SLINGER_BRIEFING}
            onBack={back}
            onAcknowledge={() => void run({command: 'acknowledge-briefing'})}
          />
        ) : (
          <KnowledgeFlow
            busy={busy}
            onBack={back}
            onDone={(picks, attemptToken) => void run({command: 'submit-knowledge', attemptToken, picks})}
          />
        )}
        <div className="body" style={{paddingTop: 0}}>{messages}</div>
      </PhoneShell>
    );
  }

  const openDefects = state.defects.length;

  return (
    <PhoneShell
      clock={clock}
      online={online}
      syncedAt={syncedAt}
      pending={0}
      back={state.assistant.name.split(' ')[0] ?? 'Помощник'}
      dock={<Dock items={ASSISTANT_DOCK} active={tab} badges={{EQUIPMENT: openDefects}} onSelect={setTab} />}
    >
      <Title note={state.assistant.name}>{TAB_TITLES[tab]}</Title>

      <div className="body">
        {messages}

        {tab === 'HOME' ? (
          <>
            <SafetySteps state={state} onStep={setDetour} />
            <Card title="Бригады">
              {state.crews.length === 0
                ? <Empty>Вас пока не записали в бригаду</Empty>
                : state.crews.map((crew) => (
                  <Row
                    key={crew.crewId}
                    title={crew.siteName}
                    note={`${crew.equipmentName} · ${crew.equipmentModel} · машинист ${crew.operatorName}`}
                  />
                ))}
            </Card>
          </>
        ) : null}

        {tab === 'SAFETY' ? <SafetySteps state={state} onStep={setDetour} /> : null}

        {tab === 'EQUIPMENT' ? (
          <Card title="Открытые неисправности">
            {state.defects.length === 0
              ? <Empty>Открытых неисправностей нет</Empty>
              : state.defects.map((defect) => (
                <Row
                  key={defect.id}
                  title={defect.title}
                  note={[
                    defect.equipmentName,
                    DEFECT_SEVERITY_FIELD_LABELS[defect.severity] ?? defect.severity,
                    defect.reportedByMe ? 'записали вы' : defect.reportedByName,
                  ].join(' · ')}
                  chip={(
                    <Chip tone={isAlarmingSeverity(defect.severity) ? 'bad' : 'warn'}>
                      {DEFECT_STATUS_FIELD_LABELS[defect.status] ?? defect.status}
                    </Chip>
                  )}
                />
              ))}
          </Card>
        ) : null}

        {tab === 'MORE' ? (
          <>
            <Card title="Помощник машиниста">
              <CardBody>
                <div className="pairs">
                  <Pair label="Имя" value={state.assistant.name} />
                  <Pair label="Бригад" value={state.crews.length} />
                </div>
              </CardBody>
            </Card>
            <Card title="Документы">
              {state.documents.length === 0
                ? <Empty>Документы не заведены</Empty>
                : state.documents.map((document) => (
                  <Row
                    key={document.typeId}
                    title={document.name}
                    note={[
                      document.number ? `№ ${document.number}` : null,
                      document.expiresAt ? `до ${formatRuDate(String(document.expiresAt))}` : 'бессрочный',
                    ].filter(Boolean).join(' · ')}
                    chip={<Chip tone={DOCUMENT_TONE[document.verdict]}>{DOCUMENT_LABEL[document.verdict]}</Chip>}
                  />
                ))}
            </Card>
            <Button tone="ghost" onClick={() => { window.location.href = '/assistant'; }}>
              Рабочий экран помощника
            </Button>
          </>
        ) : null}
      </div>
    </PhoneShell>
  );
}

/** Два шага помощника: прочитал инструкцию и подтвердил знания. */
function SafetySteps({state, onStep}: {state: AssistantState; onStep: (detour: Detour) => void}) {
  return (
    <>
      <Card title="Перед работой">
        <Row
          state={state.briefing.ok ? 'done' : 'now'}
          mark={state.briefing.ok ? '✓' : 1}
          title="Ознакомление с инструкцией"
          note={state.briefing.ok
            ? `${state.briefing.title}, версия ${state.briefing.version}`
            : `${state.briefing.title} · чтение ${state.briefing.readingMinutes} мин`}
          onClick={() => onStep('BRIEFING')}
        />
        <Row
          state={state.knowledge.ok ? 'done' : (state.briefing.ok ? 'now' : 'idle')}
          mark={state.knowledge.ok ? '✓' : 2}
          title="Проверка знаний стропальщика"
          note={state.knowledge.ok
            ? `Действует до ${formatRuDate(state.knowledge.validUntil)}`
            : (state.knowledge.lastResult ?? 'Не выполнено')}
          onClick={() => onStep('KNOWLEDGE')}
        />
      </Card>
      {state.briefing.ok && state.knowledge.ok ? (
        <Banner tone="ok" title="Допуск в порядке" note="Инструктаж пройден, знания подтверждены." />
      ) : (
        <Banner
          tone="info"
          title="Прохождение занимает 5–10 минут"
          note="Это важно для вашей безопасности и безопасности коллег"
        />
      )}
    </>
  );
}
