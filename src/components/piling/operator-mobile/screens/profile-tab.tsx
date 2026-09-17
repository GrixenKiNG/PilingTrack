'use client';

import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {BigButton, Panel, PanelTitle} from '../ui';
import {DocumentsPanel} from './documents-panel';

/**
 * Свои допуски: документы, инструктаж, проверка знаний.
 *
 * ПОЧЕМУ ЭТО ДОСТУПНО ПОСРЕДИ СМЕНЫ. Допуск проверяется на входе, но нужен
 * человеку не только там: диспетчер спрашивает «когда у тебя кончается
 * медкомиссия» в середине дня, и ответ не должен требовать закрытия смены.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕЛЬЗЯ НИЧЕГО ИСПРАВИТЬ. Документы заводит администратор. Дать
 * машинисту править срок своей медкомиссии значило бы сделать проверку допуска
 * бессмысленной.
 */
export function ProfileTab({state, onOpenBriefing, onOpenKnowledge}: {
  state: OperatorMobileState;
  onOpenBriefing: () => void;
  onOpenKnowledge: () => void;
}) {
  const {documents, briefing, knowledge} = state.identity;

  return (
    <>
      <DocumentsPanel documents={documents} />

      <Panel tone={briefing.ok ? 'ok' : 'warning'}>
        <PanelTitle tone={briefing.ok ? 'ok' : 'warning'}>{briefing.title}</PanelTitle>
        <p className="mt-1 text-2xs text-muted-foreground">
          {briefing.acknowledgedVersion
            ? `Ознакомлены с редакцией ${briefing.acknowledgedVersion}, действует ${briefing.version}`
            : 'Ознакомление не отмечено'}
        </p>
        <div className="mt-2">
          <BigButton tone="ghost" onClick={onOpenBriefing}>Прочитать инструкцию</BigButton>
        </div>
      </Panel>

      <Panel tone={knowledge.ok ? 'ok' : 'warning'}>
        <PanelTitle tone={knowledge.ok ? 'ok' : 'warning'}>Проверка знаний</PanelTitle>
        <p className="mt-1 text-2xs text-muted-foreground">
          {knowledge.validUntil
            ? `Действует до ${new Date(knowledge.validUntil).toLocaleDateString('ru-RU')}`
            : 'Ещё не пройдена'}
          {knowledge.lastResult ? ` · последний результат: ${knowledge.lastResult}` : ''}
        </p>
        <div className="mt-2">
          <BigButton tone="ghost" onClick={onOpenKnowledge}>Пройти заново</BigButton>
        </div>
      </Panel>
    </>
  );
}
