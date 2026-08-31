'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  ApiError, currentPosition, fetchState, newCommandId, sendCommand, type ProductionEntryInput,
} from './api';
import {BigButton, Panel, PanelTitle, PhaseBar, Screen} from './ui';
import {IdentityScreen} from './screens/identity-screen';
import {BriefingScreen} from './screens/briefing-screen';
import {KnowledgeScreen} from './screens/knowledge-screen';
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

/** Экраны, открываемые вне очереди фаз. */
type Detour = {kind: 'BRIEFING'} | {kind: 'KNOWLEDGE'} | {kind: 'CHECKLIST'; stage: ChecklistStage};

/**
 * Мобильное рабочее место машиниста.
 *
 * ПОЧЕМУ ЭКРАН ВЫБИРАЕТ СЕРВЕР, А НЕ КЛИЕНТ. Фаза приходит из ответа сервера и
 * целиком выведена из записанных фактов. У телефона нет своего мнения о том,
 * где находится смена: закрыл приложение на осмотре, открыл через час —
 * вернулся на осмотр, а не в начало и не вперёд.
 */
export function OperatorMobileApp() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detour, setDetour] = useState<Detour | null>(null);
  const coordinates = useRef<{latitude: number; longitude: number} | null>(null);

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

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await work();
      setChecklistCommandId(newCommandId());
      setDetour(null);
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
        <Panel tone="danger">
          <PanelTitle tone="danger">{loadError}</PanelTitle>
          <p className="mt-1 text-sm">
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
        <p className="text-sm text-muted-foreground">Считываем допуски, машину и погоду…</p>
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

  const stage = detour?.kind === 'CHECKLIST' ? detour.stage : PHASE_STAGE[state.phase] ?? null;
  const checklist = stage
    ? state.checklists.find((candidate) => candidate.stage === stage)
    : undefined;

  const screen = () => {
    if (detour?.kind === 'BRIEFING') {
      return (
        <BriefingScreen
          busy={busy}
          onAcknowledge={() => void run(() => sendCommand({command: 'acknowledge-briefing'}))}
          onBack={() => setDetour(null)}
        />
      );
    }

    if (detour?.kind === 'KNOWLEDGE') {
      return (
        <KnowledgeScreen
          busy={busy}
          error={actionError}
          onDone={(picks) => void run(() => sendCommand({command: 'submit-knowledge', picks}))}
          onBack={() => setDetour(null)}
        />
      );
    }

    if (checklist) {
      return (
        <ChecklistScreen
          checklist={checklist}
          warnings={state.warnings}
          onSubmit={submitChecklist(checklist.stage)}
          busy={busy}
          error={actionError}
          commandId={checklistCommandId}
          onBack={detour ? () => setDetour(null) : undefined}
        />
      );
    }

    switch (state.phase) {
      case 'IDENTITY':
        return (
          <IdentityScreen
            identity={state.identity}
            operatorName={state.operator.name}
            warnings={state.warnings}
            onBriefing={() => setDetour({kind: 'BRIEFING'})}
            onKnowledge={() => setDetour({kind: 'KNOWLEDGE'})}
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
        if (!shift) return <Screen title="Смена"><p className="text-sm">Смена не найдена.</p></Screen>;
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
            onOpenSafety={(safetyStage) => setDetour({kind: 'CHECKLIST', stage: safetyStage})}
            onFinish={() => void run(() => sendCommand({command: 'finish-work', shiftId: shift.id}))}
          />
        );
      case 'CLOSING':
        if (!shift) return <Screen title="Смена"><p className="text-sm">Смена не найдена.</p></Screen>;
        return (
          <ClosingScreen
            state={state}
            busy={busy}
            error={actionError}
            onOpenService={() => setDetour({kind: 'CHECKLIST', stage: 'EO_AFTER'})}
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
        return <Screen title="Смена"><p className="text-sm">Экран готовится…</p></Screen>;
    }
  };

  return (
    <div className="mx-auto min-h-dvh max-w-[560px] bg-background">
      <PhaseBar progress={state.progress} />
      {screen()}
    </div>
  );
}
