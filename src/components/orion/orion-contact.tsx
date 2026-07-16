'use client';

import { useState } from 'react';
import { ArrowDownRight, Check, ShieldCheck } from 'lucide-react';
import styles from './orion-site.module.css';

export function OrionContact() {
  const [formState, setFormState] = useState<'idle' | 'unconfigured'>('idle');

  return (
    <section className={styles.contact} id="contact">
      <div>
        <p className={styles.kicker}>Тендерный контакт</p>
        <h2>Начнём с<br /><em>вашего объекта.</em></h2>
        <p>Опишите задачу и подготовьте исходные данные. Подтверждённый канал приёма обращений будет опубликован после согласования компанией.</p>
        <div className={styles.contactNotes}>
          <span><ShieldCheck /> Работа по ППР и проекту</span>
          <span><Check /> Техника с экипажем</span>
        </div>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); setFormState('unconfigured'); }}>
        <label>Ваше имя<input required name="name" autoComplete="name" /></label>
        <label>Телефон или e-mail<input required name="contact" autoComplete="email" /></label>
        <label>О чём нужно поговорить?<textarea name="message" rows={4} placeholder="Тип объекта, сроки, технология или аренда техники" /></label>
        <button type="submit">Отправить запрос <ArrowDownRight /></button>
        {formState === 'unconfigured' && (
          <p className={styles.formNotice} role="status">Онлайн-отправка ещё не подключена. Контакт для тендерных заявок будет опубликован после подтверждения компанией.</p>
        )}
      </form>
    </section>
  );
}

