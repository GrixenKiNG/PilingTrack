'use client';

import type {DocumentCheck} from '@/modules/operator-mobile/contracts';
import {BigButton, Panel, Screen} from '../ui';

const VERDICT_TEXT: Record<DocumentCheck['verdict'], string> = {
  VALID: 'Действует',
  EXPIRING: 'Скоро истекает',
  EXPIRED: 'Просрочен',
  MISSING: 'Не заведён',
};

function tone(check: DocumentCheck) {
  if (check.verdict === 'VALID') return 'ok' as const;
  if (check.verdict === 'EXPIRING') return 'warning' as const;
  return check.required ? ('stop' as const) : ('warning' as const);
}

/**
 * Первый экран смены: имеет ли человек право работать сегодня.
 *
 * ПОЧЕМУ ЭТО ПЕРВЫЙ ЭКРАН, А НЕ ПРОВЕРКА ГДЕ-ТО В ГЛУБИНЕ. Просроченная
 * медсправка обнаруживается либо здесь, за минуту до смены, либо в акте
 * расследования. Здесь дешевле.
 */
export function IdentityScreen({operatorName, documents, valid, onContinue}: {
  operatorName: string;
  documents: DocumentCheck[];
  valid: boolean;
  onContinue: () => void;
}) {
  const required = documents.filter((document) => document.required);
  const optional = documents.filter((document) => !document.required);

  return (
    <Screen
      title="Допуск к работе"
      subtitle={operatorName}
      footer={(
        <BigButton onClick={onContinue} disabled={!valid}>
          {valid ? 'Принять установку' : 'Работа запрещена'}
        </BigButton>
      )}
    >
      {!valid ? (
        <Panel tone="stop">
          <h2 className="text-xl font-bold">К смене не допущены</h2>
          <p className="mt-1 text-base">
            Нет действующего обязательного документа. Сообщите диспетчеру — обойти эту проверку нельзя.
          </p>
        </Panel>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-bold">Обязательные документы</h2>
        {required.length === 0 ? (
          <Panel tone="warning">
            <p className="text-base">
              Администратор не отметил ни один документ обязательным. Проверять нечего — уточните
              у диспетчера, так ли это задумано.
            </p>
          </Panel>
        ) : null}
        {required.map((document) => (
          <Panel key={document.typeId} tone={tone(document)}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold leading-snug">{document.name}</h3>
              <span className="shrink-0 text-base font-bold">{VERDICT_TEXT[document.verdict]}</span>
            </div>
            {document.expiresAt ? (
              <p className="mt-1 text-base text-neutral-700">
                До {new Date(document.expiresAt).toLocaleDateString('ru-RU')}
                {document.daysLeft !== null && document.daysLeft >= 0
                  ? ` · осталось ${document.daysLeft} дн.`
                  : ''}
              </p>
            ) : document.verdict === 'VALID' ? (
              <p className="mt-1 text-base text-neutral-700">Бессрочный</p>
            ) : null}
          </Panel>
        ))}
      </div>

      {optional.length > 0 ? (
        <details className="rounded-2xl border-2 border-neutral-300 p-4">
          <summary className="text-lg font-bold">Остальные документы ({optional.length})</summary>
          <ul className="mt-3 space-y-2">
            {optional.map((document) => (
              <li key={document.typeId} className="flex justify-between gap-3 text-base">
                <span>{document.name}</span>
                <span className="shrink-0 font-semibold text-neutral-600">
                  {VERDICT_TEXT[document.verdict]}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Screen>
  );
}
