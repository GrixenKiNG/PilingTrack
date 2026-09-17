'use client';

import type {ReactNode} from 'react';
import {missingPpeLabels} from '@/modules/operator-mobile/contracts';
import type {IdentityView, WorkWarning} from '@/modules/operator-mobile/contracts';
import {BigButton, Panel, PanelTitle, Screen, Sign} from '../ui';
import {WarningsPanel} from '../warnings-panel';
import {DocumentsPanel} from './documents-panel';

/**
 * Первый экран смены: инструктаж, проверка знаний и документы.
 *
 * ПОЧЕМУ ДОКУМЕНТЫ НЕ ЗАПИРАЮТ ЭКРАН. Просроченная справка даёт красное
 * предупреждение — его видят и оператор, и диспетчер, — но решение о работе
 * принимает человек, а не программа. Дальше по смене не пускают только две
 * вещи: непрочитанная инструкция и непройденная проверка знаний, потому что
 * это ровно то, что оператор может исправить прямо здесь за две минуты.
 */
export function IdentityScreen({identity, operatorName, warnings, tabs, onPpe, onBriefing, onKnowledge, onContinue}: {
  identity: IdentityView;
  operatorName: string;
  warnings: WorkWarning[];
  /** Нижние вкладки. На фазе допуска они ведут в «ТБ» — см. `operator-mobile-app`. */
  tabs?: ReactNode;
  onPpe: () => void;
  onBriefing: () => void;
  onKnowledge: () => void;
  onContinue: () => void;
}) {
  const ready = identity.ppe.confirmed && identity.briefing.ok && identity.knowledge.ok;
  const nextAction = !identity.ppe.confirmed
    ? {label: 'Проверить средства защиты', run: onPpe}
    : !identity.briefing.ok
    ? {label: 'Прочитать инструкцию', run: onBriefing}
    : !identity.knowledge.ok
      ? {label: 'Пройти проверку знаний', run: onKnowledge}
      : {label: 'Принять установку', run: onContinue};

  return (
    <Screen
      title="Допуск к работе"
      subtitle={`${operatorName} · машинист сваебойной установки`}
      footer={<BigButton onClick={nextAction.run}>{nextAction.label}</BigButton>}
      tabs={tabs}
    >
      <WarningsPanel warnings={warnings} />

      {/* Итог допуска. Не отдельный экран: это то же состояние, только всё
          пройдено — лишний переход между «готово» и «готово» человек в шесть
          утра воспринимает как сбой. Перечисляем шаги поимённо, потому что
          зелёная галочка без расшифровки не говорит, ЧТО именно зачтено. */}
      {ready && (
        <Panel tone="ok">
          <div className="flex gap-3">
            <Sign tone="ok" />
            <div className="min-w-0 flex-1">
              <PanelTitle tone="ok">Вы допущены к смене</PanelTitle>
              <ul className="mt-2 grid gap-1 text-sm">
                <li>
                  ✓ Средства защиты —{' '}
                  {identity.ppe.missing.length
                    ? `проверены, не хватает: ${missingPpeLabels(identity.ppe.missing).join(', ')}`
                    : 'комплект полон'}
                </li>
                <li>✓ Ознакомление с инструкцией — версия {identity.briefing.version}</li>
                <li>
                  ✓ Проверка знаний{identity.knowledge.lastResult ? ` — ${identity.knowledge.lastResult}` : ''}
                </li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Осталось принять установку — дальше начинается смена.
              </p>
            </div>
          </div>
        </Panel>
      )}

      {/* СИЗ стоит первым: проверять каску после проверки знаний поздно —
          человек уже мысленно на площадке. */}
      <Panel tone={identity.ppe.confirmed ? (identity.ppe.missing.length ? 'warning' : 'ok') : 'warning'}>
        <div className="flex gap-3">
          <Sign tone={identity.ppe.confirmed && !identity.ppe.missing.length ? 'ok' : 'warning'} />
          <div className="min-w-0 flex-1">
            <PanelTitle tone={identity.ppe.confirmed && !identity.ppe.missing.length ? 'ok' : 'warning'}>
              Средства индивидуальной защиты
            </PanelTitle>
            <p className="mt-1 text-sm">
              {!identity.ppe.confirmed
                ? 'Комплект ещё не проверен. Это первый шаг допуска, занимает полминуты.'
                : identity.ppe.missing.length
                  ? `Проверено, но не хватает: ${missingPpeLabels(identity.ppe.missing).join(', ')}.`
                  : 'Комплект проверен, всё на месте.'}
            </p>
          </div>
        </div>
      </Panel>

      <Panel tone={identity.briefing.ok ? 'ok' : 'warning'}>
        <div className="flex gap-3">
          <Sign tone={identity.briefing.ok ? 'ok' : 'warning'} />
          <div className="min-w-0 flex-1">
            <PanelTitle tone={identity.briefing.ok ? 'ok' : 'warning'}>
              {identity.briefing.title}
            </PanelTitle>
            <p className="mt-1 text-sm">
              {identity.briefing.ok
                ? `${identity.briefing.code}, версия ${identity.briefing.version}. Ознакомлены.`
                : identity.briefing.acknowledgedVersion
                  ? `Текст изменился: вы читали версию ${identity.briefing.acknowledgedVersion}, действует ${identity.briefing.version}.`
                  : `${identity.briefing.code}, версия ${identity.briefing.version}. Читается за две минуты.`}
            </p>
          </div>
        </div>
      </Panel>

      <Panel tone={identity.knowledge.ok ? 'ok' : 'warning'}>
        <div className="flex gap-3">
          <Sign tone={identity.knowledge.ok ? 'ok' : 'warning'} />
          <div className="min-w-0 flex-1">
            <PanelTitle tone={identity.knowledge.ok ? 'ok' : 'warning'}>
              Проверка знаний по охране труда
            </PanelTitle>
            <p className="mt-1 text-sm">
              {identity.knowledge.ok && identity.knowledge.validUntil
                ? `Пройдена: ${identity.knowledge.lastResult ?? ''}. Действует до ${new Date(identity.knowledge.validUntil).toLocaleDateString('ru-RU')}.`
                : 'Восемь вопросов, каждый раз разные. Ошибка не заваливает попытку — вопрос повторится.'}
            </p>
          </div>
        </div>
      </Panel>

      <DocumentsPanel documents={identity.documents} />

      {!ready ? null : (
        <Panel tone="ok">
          <p className="text-sm">Допуск оформлен. Можно принимать установку.</p>
        </Panel>
      )}
    </Screen>
  );
}
