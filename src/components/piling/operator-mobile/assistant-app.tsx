'use client';

import {useCallback, useEffect, useState} from 'react';
import {
  SLINGER_BRIEFING, type AssistantState,
} from '@/modules/operator-mobile/contracts';
import {ApiError} from './api';
import {AssistantDefectForm} from './screens/assistant-defect-form';
import {BriefingScreen} from './screens/briefing-screen';
import {KnowledgeScreen} from './screens/knowledge-screen';
import {
  DEFECT_SEVERITY_FIELD_LABELS, DEFECT_STATUS_FIELD_LABELS, isAlarmingSeverity,
} from '@/modules/operator-mobile/domain/defect-labels';
import {BigButton, ErrorNote, Fact, Panel, PanelTitle, Screen, Sign} from './ui';

/**
 * Рабочее место помощника машиниста.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ. Инструктаж по стропальным работам, проверка знаний и свои
 * допуски со сроками: медкомиссия, удостоверение стропальщика,
 * электробезопасность, работы на высоте.
 *
 * ЧЕГО НЕТ И ПОЧЕМУ. Смены. Её ведёт машинист — он принимает установку,
 * осматривает её и записывает выработку; помощник в бригаде числится, но
 * команд смены не подаёт. Раньше он видел в меню «Смену», открывал её и
 * получал отказ: единственный заметный пункт вёл в тупик.
 */

const VERDICT_LABELS: Record<string, string> = {
  VALID: 'действует',
  EXPIRING: 'скоро истекает',
  EXPIRED: 'просрочен',
  MISSING: 'не заведён',
};

type Detour = 'BRIEFING' | 'KNOWLEDGE' | null;

async function fetchState(): Promise<AssistantState> {
  const response = await fetch('/api/assistant/state', {credentials: 'same-origin'});
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'Не удалось загрузить данные');
  }
  return body.data as AssistantState;
}

async function sendCommand(command: unknown): Promise<void> {
  const response = await fetch('/api/assistant/command', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'same-origin',
    body: JSON.stringify(command),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'Команда не выполнена');
  }
}

export function AssistantApp() {
  const [state, setState] = useState<AssistantState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detour, setDetour] = useState<Detour>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchState();
        if (!cancelled) { setState(next); setLoadError(null); }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- намеренно: сессия истекла, полная перезагрузка сбрасывает кэш маршрутов и память вкладки прежнего входа
          window.location.href = '/login';
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setForbidden(error.message);
          return;
        }
        setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить данные');
      }
    })();
    return () => { cancelled = true; };
  }, [reloadToken]);

  // Экран закрывается только после ответа сервера — то же правило, что и на
  // месте машиниста: прочитанная инструкция и пройденная проверка не должны
  // теряться из-за оборвавшегося запроса.
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      setDetour(null);
      reload();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Команда не выполнена');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (forbidden) {
    return (
      <Screen title="Рабочее место помощника">
        <Panel>
          <PanelTitle>{forbidden}</PanelTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Этот экран ведёт помощник машиниста. Смену открывает и записывает машинист,
            закреплённый за установкой.
          </p>
        </Panel>
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen title="Нет связи" footer={<BigButton onClick={reload}>Повторить</BigButton>}>
        <Panel tone="danger">
          <PanelTitle tone="danger">{loadError}</PanelTitle>
        </Panel>
      </Screen>
    );
  }

  if (!state) {
    return <Screen title="Помощник машиниста"><p className="text-sm">Загружаем…</p></Screen>;
  }

  if (detour === 'BRIEFING') {
    return (
      <BriefingScreen
        briefing={SLINGER_BRIEFING}
        busy={busy}
        onAcknowledge={() => void run(() => sendCommand({command: 'acknowledge-briefing'}))}
        onBack={() => setDetour(null)}
      />
    );
  }

  if (detour === 'KNOWLEDGE') {
    return (
      <KnowledgeScreen
        busy={busy}
        error={actionError}
        onDone={(picks, attemptToken) => void run(() => sendCommand({command: 'submit-knowledge', picks, attemptToken}))}
        onBack={() => setDetour(null)}
      />
    );
  }

  const invalid = state.documents.filter(
    (document) => document.required && (document.verdict === 'MISSING' || document.verdict === 'EXPIRED'),
  );
  const expiring = state.documents.filter(
    (document) => document.required && document.verdict === 'EXPIRING',
  );
  const admitted = state.briefing.ok && state.knowledge.ok && invalid.length === 0;

  return (
    <div className="mx-auto min-h-dvh max-w-[560px] bg-background">
      <Screen title="Помощник машиниста" subtitle={state.assistant.name}>
        <ErrorNote message={actionError} />

        {/*
          Сводка сверху отвечает на единственный вопрос, с которым сюда
          заходят: «я допущен?». Красное здесь ничего не запирает — работу
          останавливает человек, а не приложение, — но диспетчер видит то же
          самое и знает, кого нельзя ставить в бригаду.
        */}
        <Panel tone={admitted ? 'ok' : 'warning'}>
          <PanelTitle tone={admitted ? 'ok' : 'warning'}>
            {admitted ? 'Допуск в порядке' : 'Допуск неполный'}
          </PanelTitle>
          {admitted ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Инструктаж пройден, проверка знаний действует, обязательные документы на месте.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {!state.briefing.ok && <li>Не пройден инструктаж по стропальным работам</li>}
              {!state.knowledge.ok && <li>Не пройдена или просрочена проверка знаний</li>}
              {invalid.length > 0 && (
                <li>{`Нет действующих документов: ${invalid.map((d) => d.name).join(', ')}`}</li>
              )}
            </ul>
          )}
          {expiring.length > 0 && (
            <p className="mt-2 text-2xs text-warning-strong">
              {`Скоро истекает: ${expiring.map((d) => `${d.name} (${d.daysLeft} дн.)`).join(', ')}`}
            </p>
          )}
        </Panel>

        <Panel tone={state.briefing.ok ? 'ok' : 'warning'}>
          <PanelTitle tone={state.briefing.ok ? 'ok' : 'warning'}>{state.briefing.title}</PanelTitle>
          <p className="mt-1 text-2xs text-muted-foreground">
            {state.briefing.code}
            {' · '}
            {state.briefing.acknowledgedVersion
              ? `ознакомлены с редакцией ${state.briefing.acknowledgedVersion}, действует ${state.briefing.version}`
              : `не ознакомлены · ${state.briefing.readingMinutes} мин чтения`}
          </p>
          <div className="mt-2">
            <BigButton
              tone={state.briefing.ok ? 'ghost' : 'primary'}
              onClick={() => setDetour('BRIEFING')}
            >
              {state.briefing.ok ? 'Перечитать инструкцию' : 'Пройти инструктаж'}
            </BigButton>
          </div>
        </Panel>

        <Panel tone={state.knowledge.ok ? 'ok' : 'warning'}>
          <PanelTitle tone={state.knowledge.ok ? 'ok' : 'warning'}>Проверка знаний</PanelTitle>
          <p className="mt-1 text-2xs text-muted-foreground">
            {state.knowledge.validUntil
              ? `действует до ${new Date(state.knowledge.validUntil).toLocaleDateString('ru-RU')}`
              : 'ещё не пройдена'}
            {state.knowledge.lastResult ? ` · последний результат: ${state.knowledge.lastResult}` : ''}
          </p>
          <div className="mt-2">
            <BigButton
              tone={state.knowledge.ok ? 'ghost' : 'primary'}
              onClick={() => setDetour('KNOWLEDGE')}
            >
              {state.knowledge.ok ? 'Пройти заново' : 'Пройти проверку'}
            </BigButton>
          </div>
        </Panel>

        <Panel>
          <PanelTitle>Мои документы</PanelTitle>
          <ul className="mt-2 space-y-2">
            {state.documents.map((document) => (
              <li key={document.typeId} className="flex gap-2 border-t pt-2 first:border-t-0 first:pt-0">
                <Sign
                  tone={
                    document.verdict === 'VALID' ? 'ok'
                      : document.verdict === 'EXPIRING' ? 'warning' : 'danger'
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {document.name}
                    {document.required ? ' · обязателен' : ''}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {VERDICT_LABELS[document.verdict] ?? document.verdict}
                    {document.number ? ` · № ${document.number}` : ''}
                    {document.expiresAt
                      ? ` · до ${new Date(document.expiresAt).toLocaleDateString('ru-RU')}`
                      : ''}
                    {document.daysLeft !== null ? ` · ${document.daysLeft} дн.` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-muted-foreground">
            Документы заводит администратор. Если срок подходит — скажите диспетчеру заранее,
            продление занимает недели.
          </p>
        </Panel>

        {state.crews.length > 0 && (
          <Panel tone={state.defects.length > 0 ? 'warning' : 'ok'}>
            <PanelTitle tone={state.defects.length > 0 ? 'warning' : 'ok'}>
              {state.defects.length > 0
                ? `Открытых неисправностей: ${state.defects.length}`
                : 'Открытых неисправностей нет'}
            </PanelTitle>
            {state.defects.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {state.defects.map((defect) => (
                  <li key={defect.id} className="flex gap-2 border-t pt-2 first:border-t-0 first:pt-0">
                    <Sign tone={isAlarmingSeverity(defect.severity) ? 'danger' : 'warning'} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{defect.title}</p>
                      <p className="text-2xs text-muted-foreground">
                        {/* Машину подписываем, только если их несколько: при одной
                            это повтор строки «Где я работаю» под каждой записью. */}
                        {state.crews.length > 1 ? `${defect.equipmentName} · ` : ''}
                        {DEFECT_SEVERITY_FIELD_LABELS[defect.severity] ?? defect.severity}
                        {' · '}
                        {DEFECT_STATUS_FIELD_LABELS[defect.status] ?? defect.status}
                        {' · с '}
                        {new Date(defect.reportedAt).toLocaleDateString('ru-RU')}
                      </p>
                      {/* Своё выделяем, чужое подписываем именем: до этого
                          запись машиниста висела здесь без автора, и спросить
                          «где именно» было не у кого. */}
                      {defect.reportedByMe ? (
                        <p className="text-2xs font-semibold text-signal">Это записали вы</p>
                      ) : (
                        <p className="text-2xs text-muted-foreground">
                          Записал: {defect.reportedByName}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              /* Пустой список — тоже ответ. Без него отсутствие панели читается
                 как «экран не умеет», и человек записывает поломку повторно. */
              <p className="mt-1 text-sm text-muted-foreground">
                По вашим машинам ничего не открыто. Закрывает неисправности механик.
              </p>
            )}
          </Panel>
        )}

        <AssistantDefectForm crews={state.crews} onReported={reload} />

        {state.crews.length > 0 && (
          <Panel>
            <PanelTitle>Где я работаю</PanelTitle>
            {state.crews.map((crew) => (
              <div key={crew.crewId} className="mt-2 space-y-1 border-t pt-2 first:border-t-0 first:pt-0">
                <Fact label="Объект" value={crew.siteName} />
                <Fact
                  label="Установка"
                  value={`${crew.equipmentName}${crew.equipmentModel ? ` · ${crew.equipmentModel}` : ''}`}
                />
                <Fact label="Машинист" value={crew.operatorName} />
              </div>
            ))}
          </Panel>
        )}
      </Screen>
    </div>
  );
}
