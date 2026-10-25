import { timeRu, dateRu, Rowline } from "./v5-shared";
import { useState } from 'react';
import type { OperatorMobileState } from '@/modules/operator-mobile';
import { PPE_ITEMS, SAFETY_BRIEFING } from '@/modules/operator-mobile/client';

/**
 * Проверка средств защиты.
 *
 * ГАЛОЧКИ СТОЯТ ЗАРАНЕЕ — отмечают ОТСУТСТВИЕ. У работника, вышедшего на
 * смену, комплект обычно полон, и шесть обязательных нажатий в шесть утра
 * превращаются в шесть нажатий не глядя. Снимать отметку человек будет
 * осознанно.
 *
 * НЕХВАТКА НЕ ЗАПИРАЕТ САМ ЭКРАН. Запертый работник вернёт галочку обратно,
 * лишь бы начать смену, и мы получим ложную запись вместо честной. Отметку
 * принимаем любую — а вот выработку она после этого запрещает
 * (`domain/production-permit.ts`), и экран обязан сказать об этом прямо.
 */
export function PpeScreenV5({busy, onConfirm, onBack}: {
  busy: boolean;
  onConfirm: (items: string[]) => void;
  onBack: () => void;
}) {
  const [present, setPresent] = useState<string[]>(() => PPE_ITEMS.map((item) => item.code));
  const missing = PPE_ITEMS.filter((item) => !present.includes(item.code));
  const toggle = (code: string) => setPresent((current) => (
    current.includes(code) ? current.filter((value) => value !== code) : [...current, code]
  ));

  return (
    <div className="scr">
      <p className="kicker">Средства защиты</p>
      <p className="m">Комплект отмечен полностью — снимите отметку с того, чего нет.</p>
      {PPE_ITEMS.map((item) => (
        <Rowline
          key={item.code}
          label={item.label}
          note={item.hint}
          badge={present.includes(item.code) ? 'есть' : 'нет'}
          tone={present.includes(item.code) ? 'good' : 'bad'}
          onClick={() => toggle(item.code)}
        />
      ))}
      {missing.length > 0 ? (
        <p className="note warn">
          Не хватает: {missing.map((item) => item.label).join(', ')}. Запишем как есть.
          Пока не получите недостающее, выработку записать нельзя — простой и
          происшествия записываются как обычно.
        </p>
      ) : null}
      <button className="b" type="button" disabled={busy} onClick={() => onConfirm(present)}>
        {busy ? 'Записываем…'
          : missing.length === 0 ? 'Комплект в порядке' : `Подтвердить (нет: ${missing.length})`}
      </button>
      <button className="b gh" type="button" onClick={onBack}>Назад</button>
    </div>
  );
}

/**
 * Ознакомление с инструкцией: сначала текст, потом отметка.
 *
 * Прежняя кнопка записывала ознакомление, не показав ни строчки. Подпись под
 * непрочитанным — это ровно та бумага, ради отказа от которой заводят
 * электронный журнал.
 */
export function BriefingScreenV5({state, busy, onAcknowledge, onBack}: {
  state: OperatorMobileState;
  busy: boolean;
  onAcknowledge: () => void;
  onBack: () => void;
}) {
  const [read, setRead] = useState(false);
  const {briefing} = state.identity;
  return (
    <div className="scr">
      <p className="kicker">{SAFETY_BRIEFING.title}</p>
      <p className="m">
        {SAFETY_BRIEFING.code} · ред. {briefing.version} · чтение {SAFETY_BRIEFING.readingMinutes} мин
      </p>
      {SAFETY_BRIEFING.sections.map((section) => (
        <div key={section.id}>
          <p className="kicker">{section.title}</p>
          {section.rules.map((rule) => <p className="m" key={rule}>— {rule}</p>)}
        </div>
      ))}
      <Rowline
        label="Я ознакомился с инструкцией"
        badge={read ? 'да' : 'нет'}
        tone={read ? 'good' : 'warn'}
        onClick={() => setRead((value) => !value)}
      />
      <button
        className={read ? 'b' : 'b dis'}
        type="button"
        disabled={busy || !read}
        onClick={onAcknowledge}
      >
        {busy ? 'Записываем…' : 'Подтвердить ознакомление'}
      </button>
      <button className="b gh" type="button" onClick={onBack}>Назад</button>
    </div>
  );
}

/* -------------------------------------------------------------- экраны --- */


/** A. Допуск — экран A2 макета, но сроки настоящие. */
export function AdmissionScreen({state, busy, onPpe, onBriefing, onKnowledge}: {
  state: OperatorMobileState;
  busy: boolean;
  onPpe: () => void;
  onBriefing: () => void;
  onKnowledge: () => void;
}) {
  const {identity} = state;
  const bad = identity.documents.filter(
    (doc) => doc.required && (doc.verdict === 'EXPIRED' || doc.verdict === 'MISSING'),
  );

  return (
    <>
      {bad.length > 0 ? (
        <div className="stop-head">
          <span className="t">Работать нельзя</span>
          <span className="s">
            {bad[0].name}: {bad[0].verdict === 'EXPIRED' ? 'просрочен' : 'нет документа'}
          </span>
        </div>
      ) : (
        <div className="ok-head">
          <span className="t">Допуск открыт</span>
          <span className="s">Все документы действуют</span>
        </div>
      )}
      <div className="scr">
        <Rowline
          label="Средства индивидуальной защиты"
          note={identity.ppe.confirmedAt
            ? `подтверждены в ${timeRu(identity.ppe.confirmedAt)}`
            : 'проверка за сегодня'}
          badge={identity.ppe.confirmed ? 'есть' : 'нужна'}
          tone={identity.ppe.confirmed ? 'ok' : 'warn'}
        />
        <Rowline
          label={identity.briefing.title}
          note={`${identity.briefing.code} · ред. ${identity.briefing.version}`}
          badge={identity.briefing.ok ? 'учтён' : 'новая'}
          tone={identity.briefing.ok ? 'ok' : 'warn'}
        />
        <Rowline
          label="Проверка знаний по ОТ"
          note={identity.knowledge.validUntil
            ? `действует до ${dateRu(identity.knowledge.validUntil)}`
            : undefined}
          badge={identity.knowledge.ok ? 'есть' : 'нужна'}
          tone={identity.knowledge.ok ? 'ok' : 'warn'}
        />
        {identity.documents.map((doc) => (
          <Rowline
            key={doc.typeId}
            label={doc.name}
            badge={doc.expiresAt ? `до ${dateRu(doc.expiresAt as unknown as string)}` : 'бессрочный'}
            tone={doc.verdict === 'VALID' ? 'ok' : doc.verdict === 'EXPIRING' ? 'warn' : 'bad'}
          />
        ))}

        {/*
          ШАГИ ДОПУСКА ОТКРЫВАЮТ СВОЙ ЭКРАН, А НЕ ЗАПИСЫВАЮТ ФАКТ ПО НАЖАТИЮ.

          Было две кнопки, которые отправляли команду прямо отсюда. «Подтвердить
          средства защиты» слала `items: state.identity.ppe.items` — а до
          подтверждения этот список ПУСТ, потому что хранит уже записанное.
          Сервер честно записывал, что у человека нет ни одного из шести
          предметов, а экран тут же показывал «есть»: ложная запись о
          безопасности, сделанная одним нажатием. «Ознакомиться с инструкцией»
          записывала ознакомление, не показав ни строчки текста.

          Теперь обе ведут на экран, где человек действительно смотрит и
          отвечает. Проверка знаний добавлена туда же: без неё допуск нового
          оператора упирался в тупик — шаг обязателен, а пройти его в модуле
          было негде.
        */}
        {!identity.ppe.confirmed ? (
          <button className="b" type="button" disabled={busy} onClick={onPpe}>
            Проверить средства защиты
          </button>
        ) : !identity.briefing.ok ? (
          <button className="b" type="button" disabled={busy} onClick={onBriefing}>
            Прочитать инструкцию
          </button>
        ) : !identity.knowledge.ok ? (
          <button className="b" type="button" disabled={busy} onClick={onKnowledge}>
            Пройти проверку знаний
          </button>
        ) : null}

        {bad.length > 0 ? (
          <p className="note bad">
            Эту блокировку нельзя снять разрешением. Нужен действующий документ.
          </p>
        ) : null}
      </div>
    </>
  );
}
