'use client';

import type {DocumentCheck, IdentityView, WorkWarning} from '@/modules/operator-mobile/contracts';
import {BigButton, Panel, PanelTitle, Screen, Sign} from '../ui';
import {WarningsPanel} from '../warnings-panel';

const VERDICT_TEXT: Record<DocumentCheck['verdict'], string> = {
  VALID: 'Действует',
  EXPIRING: 'Скоро истекает',
  EXPIRED: 'Просрочен',
  MISSING: 'Не заведён',
};

function documentTone(check: DocumentCheck) {
  if (check.verdict === 'VALID') return 'ok' as const;
  if (check.verdict === 'EXPIRING') return 'warning' as const;
  return 'danger' as const;
}

/**
 * Первый экран смены: инструктаж, проверка знаний и документы.
 *
 * ПОЧЕМУ ДОКУМЕНТЫ НЕ ЗАПИРАЮТ ЭКРАН. Просроченная справка даёт красное
 * предупреждение — его видят и оператор, и диспетчер, — но решение о работе
 * принимает человек, а не программа. Дальше по смене не пускают только две
 * вещи: непрочитанная инструкция и непройденная проверка знаний, потому что
 * это ровно то, что оператор может исправить прямо здесь за две минуты.
 */
export function IdentityScreen({identity, operatorName, warnings, onBriefing, onKnowledge, onContinue}: {
  identity: IdentityView;
  operatorName: string;
  warnings: WorkWarning[];
  onBriefing: () => void;
  onKnowledge: () => void;
  onContinue: () => void;
}) {
  const ready = identity.briefing.ok && identity.knowledge.ok;
  // Обязательные документы показываем карточками, остальные — свёрнутым
  // списком. Одиннадцать красных карточек про документы, которых никто не
  // требовал, оператор пролистывает не читая, и настоящее предупреждение
  // тонет среди них.
  const required = identity.documents.filter((document) => document.required);
  const optional = identity.documents.filter((document) => !document.required);
  const nextAction = !identity.briefing.ok
    ? {label: 'Прочитать инструкцию', run: onBriefing}
    : !identity.knowledge.ok
      ? {label: 'Пройти проверку знаний', run: onKnowledge}
      : {label: 'Принять установку', run: onContinue};

  return (
    <Screen
      title="Допуск к работе"
      subtitle={`${operatorName} · машинист сваебойной установки`}
      footer={<BigButton onClick={nextAction.run}>{nextAction.label}</BigButton>}
    >
      <WarningsPanel warnings={warnings} />

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

      <div className="space-y-2 pt-1">
        <h2 className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Документы
        </h2>
        {identity.documents.length === 0 ? (
          <Panel>
            <p className="text-sm text-muted-foreground">
              Виды документов в справочнике не заведены. Проверять нечего — уточните у диспетчера.
            </p>
          </Panel>
        ) : null}
        {required.map((document) => (
          <Panel key={document.typeId} tone={documentTone(document)}>
            <div className="flex gap-3">
              <Sign tone={documentTone(document)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium leading-snug">{document.name}</span>
                  <span className="shrink-0 text-2xs font-semibold">
                    {document.verdict === 'EXPIRING' && document.daysLeft !== null
                      ? `${document.daysLeft} дн.`
                      : VERDICT_TEXT[document.verdict]}
                  </span>
                </div>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {document.number ? `№ ${document.number}` : 'номер не указан'}
                  {document.expiresAt
                    ? ` · до ${new Date(document.expiresAt).toLocaleDateString('ru-RU')}`
                    : document.verdict === 'VALID' ? ' · бессрочный' : ''}
                </p>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      {optional.length > 0 ? (
        <details className="rounded-lg border bg-card p-4 shadow-xs">
          <summary className="cursor-pointer text-sm font-medium">
            Остальные документы ({optional.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {optional.map((document) => (
              <li key={document.typeId} className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{document.name}</span>
                <span className="shrink-0 text-2xs font-medium text-muted-foreground">
                  {VERDICT_TEXT[document.verdict]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-2xs text-muted-foreground">
            Эти виды администратор не отметил обязательными для машиниста, поэтому их отсутствие
            смену не задерживает.
          </p>
        </details>
      ) : null}

      {!ready ? null : (
        <Panel tone="ok">
          <p className="text-sm">Допуск оформлен. Можно принимать установку.</p>
        </Panel>
      )}
    </Screen>
  );
}
