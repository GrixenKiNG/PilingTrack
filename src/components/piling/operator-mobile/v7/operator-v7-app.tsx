'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {OperatorMobileState, OperatorPhase} from '@/modules/operator-mobile/contracts';
import {PHASE_LABELS, PHASE_ORDER} from '@/modules/operator-mobile/contracts';
import {ApiError, currentPosition, fetchState} from '../api';
import {
  AdmissionScreen, ChecklistsScreen, ClosingScreen, EquipmentScreen, IdentityScreen,
  IncidentsScreen, ProfileScreen, WarningsBlock, WorkScreen,
} from './v7-screens';

/**
 * Модуль оператора v7 — визуализация на живых данных.
 *
 * Экран собран по макетам `docs/operator-module/`, а состояние берёт оттуда же,
 * откуда рабочий экран: `/api/operator/mobile/state`. Фазу, допуск, чек-листы и
 * выработку считает сервер — у телефона своего мнения о смене нет.
 *
 * ПОЧЕМУ ТОЛЬКО ЧТЕНИЕ. Команды смены (приём установки, сдача чек-листа, учёт
 * выработки, закрытие) уже реализованы в `/operator` вместе с офлайн-очередью и
 * защитой от двойного нажатия на морозе. Второй набор кнопок к тем же командам
 * — это второе место, где смену можно испортить, и вдвое больше кода, который
 * обязан остаться верным правилам. Поэтому v7 показывает состояние и отправляет
 * за действиями на рабочий экран.
 *
 * Доступ тот же, что у рабочего экрана: состояние отдаётся только роли OPERATOR.
 */

/** Разделы, между которыми переключается низ экрана. */
type Tab = 'SHIFT' | 'EQUIPMENT' | 'INCIDENTS' | 'PROFILE';

const TAB_LABELS: Record<Tab, string> = {
  SHIFT: 'Смена', EQUIPMENT: 'Техника', INCIDENTS: 'События', PROFILE: 'Профиль',
};

/** Фазы, показываемые полосой прогресса. `CLOSED` — не шаг, а итог. */
const TIMELINE: OperatorPhase[] = PHASE_ORDER.filter((phase) => phase !== 'CLOSED');

/** Заголовок экрана по фазе — той же формулировкой, что в макетах. */
const PHASE_TITLES: Record<OperatorPhase, string> = {
  IDENTITY: 'Перед сменой — Техника безопасности',
  ADMISSION: 'Принятие установки',
  PRESHIFT_INSPECTION: 'Предсменный осмотр',
  STARTUP: 'Пуск и ежесменное обслуживание',
  SITE_READY: 'Осмотр площадки',
  WORK: 'Работа',
  CLOSING: 'Сдача смены',
  CLOSED: 'Смена закрыта',
};

/** Чек-листы, относящиеся к фазе. В остальных фазах список пуст. */
function phaseChecklists(state: OperatorMobileState) {
  const stages: Partial<Record<OperatorPhase, string[]>> = {
    PRESHIFT_INSPECTION: ['PRESHIFT_INSPECTION'],
    STARTUP: ['EO_BEFORE'],
    SITE_READY: ['SITE_READY'],
    WORK: ['TB_PILING', 'TB_DRILLING'],
    CLOSING: ['EO_AFTER'],
  };
  const wanted = stages[state.phase] ?? [];
  return state.checklists.filter((checklist) => wanted.includes(checklist.stage));
}

export function OperatorV7App() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('SHIFT');
  const coordinates = useRef<{latitude: number; longitude: number} | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await fetchState({coordinates: coordinates.current});
      setState(next);
      setError(null);
      setSyncedAt(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError(cause instanceof ApiError ? cause.message : 'Не удалось получить состояние смены');
    }
  }, []);

  useEffect(() => {
    // Сначала координаты, потом состояние: без координат сервер не отдаёт
    // погоду, а без погоды в чек-лист не попадают сезонные пункты.
    void (async () => {
      coordinates.current = await currentPosition();
      await reload();
    })();
  }, [reload]);

  if (error) {
    return (
      <div className="state">
        <h2>Состояние смены недоступно</h2>
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => void reload()}>Повторить</button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="state">
        <h2>Загрузка</h2>
        <p>Читаем состояние смены</p>
      </div>
    );
  }

  const phaseIndex = TIMELINE.indexOf(state.phase);
  const openIncidents = state.incidents.filter((incident) => incident.reviewedAt === null).length;

  return (
    <>
      <header className="head">
        <div className="top">
          <a className="back" href="/operator">← Рабочий экран</a>
          <span className="sync">
            <span className="dot" />
            {syncedAt ? `Синхронизировано ${syncedAt}` : 'Синхронизация'}
          </span>
        </div>
        <h1>{PHASE_TITLES[state.phase]}</h1>
        <div className="sub">
          {state.operator.name}
          {state.assignment ? ` · ${state.assignment.siteName} · ${state.assignment.equipmentName}` : ''}
        </div>
        <div className="tl">
          {TIMELINE.map((phase, index) => (
            <span
              key={phase}
              className={`ph ${state.phase === 'CLOSED' || index < phaseIndex ? 'done' : ''} ${phase === state.phase ? 'now' : ''}`}
            >
              {PHASE_LABELS[phase]}
            </span>
          ))}
        </div>
      </header>

      <main className="body">
        {tab === 'SHIFT' ? (
          <>
            <WarningsBlock warnings={state.warnings} />
            {state.phase === 'IDENTITY' ? <IdentityScreen state={state} /> : null}
            {state.phase === 'ADMISSION' ? <AdmissionScreen state={state} /> : null}
            {['PRESHIFT_INSPECTION', 'STARTUP', 'SITE_READY'].includes(state.phase) ? (
              <>
                <AdmissionScreen state={state} />
                <ChecklistsScreen checklists={phaseChecklists(state)} />
              </>
            ) : null}
            {state.phase === 'WORK' ? (
              <>
                <WorkScreen state={state} />
                <ChecklistsScreen checklists={phaseChecklists(state)} />
              </>
            ) : null}
            {state.phase === 'CLOSING' || state.phase === 'CLOSED' ? (
              <ClosingScreen state={state} />
            ) : null}
          </>
        ) : null}

        {tab === 'EQUIPMENT' ? <EquipmentScreen defects={state.defects} /> : null}
        {tab === 'INCIDENTS' ? <IncidentsScreen incidents={state.incidents} /> : null}
        {tab === 'PROFILE' ? <ProfileScreen state={state} /> : null}
      </main>

      <nav className="tabs">
        {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'on' : ''}
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
          >
            {TAB_LABELS[key]}
            {key === 'INCIDENTS' && openIncidents > 0 ? <span className="cnt">{openIncidents}</span> : null}
          </button>
        ))}
      </nav>
    </>
  );
}
