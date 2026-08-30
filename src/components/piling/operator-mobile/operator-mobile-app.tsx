'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {ChecklistAnswer, ChecklistStage, OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {
  ApiError, currentPosition, fetchState, newCommandId, sendCommand, type ProductionEntryInput,
} from './api';
import {BigButton, PhaseBar, Panel, Screen} from './ui';
import {IdentityScreen} from './screens/identity-screen';
import {AdmissionScreen} from './screens/admission-screen';
import {ChecklistScreen} from './screens/checklist-screen';
import {WorkScreen} from './screens/work-screen';
import {ClosedScreen, ClosingScreen} from './screens/closing-screen';

/** Чек-лист, закрывающий фазу. Тот же порядок, что на сервере. */
const PHASE_STAGE: Partial<Record<OperatorMobileState['phase'], ChecklistStage>> = {
  PRESHIFT_INSPECTION: 'PRESHIFT_INSPECTION',
  STARTUP: 'EO_BEFORE',
  SITE_READY: 'SITE_READY',
};

/**
 * Мобильное рабочее место машиниста.
 *
 * ПОЧЕМУ ЭКРАН ВЫБИРАЕТ СЕРВЕР, А НЕ КЛИЕНТ. Фаза приходит из ответа сервера и
 * целиком выведена из записанных фактов. У телефона нет своего мнения о том,
 * где находится смена: закрыл приложение на осмотре, открыл через час — вернулся
 * на осмотр, а не в начало и не вперёд.
 */
export function OperatorMobileApp() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Чек-лист, открытый вне очереди: ТБ перед работой, ЕО перед закрытием. */
  const [openStage, setOpenStage] = useState<ChecklistStage | null>(null);
  const coordinates = useRef<{latitude: number; longitude: number} | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await fetchState({coordinates: coordinates.current});
      setState(next);
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.location.href = '/login';
        return;
      }
      setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить смену');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      coordinates.current = await currentPosition();
      await reload();
    })();
  }, [reload]);

  /**
   * Ключ открытого чек-листа. К нему привязываются снимки, сделанные до
   * отправки, поэтому он обязан пережить перерисовки — но не пережить отправку:
   * новый ключ выдаётся после каждой удачной команды, иначе повторная сдача
   * списка вернула бы прежний результат вместо новой записи.
   *
   * Хранится в состоянии, а не в ref: ref во время отрисовки читать нельзя,
   * а ключ нужен именно при отрисовке — его получает экран чек-листа.
   */
  const [checklistCommandId, setChecklistCommandId] = useState(newCommandId);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      setChecklistCommandId(newCommandId());
      setOpenStage(null);
      await reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Команда не выполнена');
    } finally {
      setBusy(false);
    }
  }, [reload]);

  if (loadError) {
    return (
      <Screen title="Нет связи" footer={<BigButton onClick={() => void reload()}>Повторить</BigButton>}>
        <Panel tone="stop">
          <p className="text-lg font-bold">{loadError}</p>
          <p className="mt-1 text-base">
            Рабочее место работает только на связи. Дождитесь сети и повторите — записывать смену
            «в стол» приложение не станет, чтобы не потерять её молча.
          </p>
        </Panel>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen title="Загрузка смены">
        <p className="text-lg text-neutral-600">Считываем допуски, машину и погоду…</p>
      </Screen>
    );
  }

  const shift = state.shift;
  const assignment = state.assignment;

  const submitChecklist = (stage: ChecklistStage) => (answers: ChecklistAnswer[]) => {
    if (!shift || !assignment) return;
    void run(() => sendCommand({
      command: 'submit-checklist',
      clientCommandId: checklistCommandId,
      shiftId: shift.id,
      equipmentId: assignment.equipmentId,
      stage,
      answers,
    }));
  };

  const stage = openStage ?? PHASE_STAGE[state.phase] ?? null;
  const checklist = stage
    ? state.checklists.find((candidate) => candidate.stage === stage)
    : undefined;

  const screen = () => {
    if (checklist) {
      return (
        <ChecklistScreen
          checklist={checklist}
          blockers={state.blockers}
          onSubmit={submitChecklist(checklist.stage)}
          busy={busy}
          error={actionError}
          commandId={checklistCommandId}
          onBack={openStage ? () => setOpenStage(null) : undefined}
        />
      );
    }

    switch (state.phase) {
      case 'IDENTITY':
        return (
          <IdentityScreen
            operatorName={state.operator.name}
            documents={state.identity.documents}
            valid={state.identity.valid}
            onContinue={() => void reload()}
          />
        );
      case 'ADMISSION':
        return (
          <AdmissionScreen
            state={state}
            busy={busy}
            error={actionError}
            onAccept={(input) => void run(() => sendCommand({
              command: 'accept-equipment',
              clientCommandId: newCommandId(),
              ...input,
            }))}
          />
        );
      case 'WORK':
        if (!shift) return <Screen title="Смена"><p className="text-lg">Смена не найдена.</p></Screen>;
        return (
          <WorkScreen
            state={state}
            busy={busy}
            error={actionError}
            onLog={(entry: ProductionEntryInput) => void run(() => sendCommand({
              command: 'log-production',
              clientCommandId: newCommandId(),
              shiftId: shift.id,
              entry,
            }))}
            onOpenSafety={(safetyStage) => setOpenStage(safetyStage)}
            onRequestClosing={() => void run(() => sendCommand({
              command: 'request-closing',
              shiftId: shift.id,
            }))}
          />
        );
      case 'CLOSING':
        if (!shift) return <Screen title="Смена"><p className="text-lg">Смена не найдена.</p></Screen>;
        return (
          <ClosingScreen
            state={state}
            busy={busy}
            error={actionError}
            onOpenService={() => setOpenStage('EO_AFTER')}
            onClose={(comment) => void run(() => sendCommand({
              command: 'close-shift',
              shiftId: shift.id,
              comment,
            }))}
          />
        );
      case 'CLOSED':
        return <ClosedScreen state={state} />;
      default:
        return <Screen title="Смена"><p className="text-lg">Экран готовится…</p></Screen>;
    }
  };

  return (
    <div className="mx-auto max-w-[560px] bg-white">
      <PhaseBar progress={state.progress} />
      {screen()}
    </div>
  );
}
