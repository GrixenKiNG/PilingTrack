'use client';

import { useState } from 'react';
import { ArrowDownRight, Check, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react';
import { orionRequisites } from './orion-content';
import styles from './orion-site.module.css';

type SubmitState = 'idle' | 'sending' | 'sent' | 'error';

export function OrionContact() {
  const [state, setState] = useState<SubmitState>('idle');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'sending') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get('name') ?? ''),
      contact: String(data.get('contact') ?? ''),
      message: String(data.get('message') ?? ''),
      consent: data.get('consent') === 'on',
      website: String(data.get('website') ?? ''),
    };

    setState('sending');
    try {
      const res = await fetch('/api/orion/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <section className={styles.contact} id="contact">
      <div>
        <p className={styles.kicker}>Контакты</p>
        <h2>Начнём с<br /><em>вашего объекта.</em></h2>
        <p>Опишите задачу и подготовьте исходные данные — позвоните, напишите или оставьте заявку.</p>
        <ul className={styles.contactChannels}>
          {orionRequisites.phones.map((phone) => (
            <li key={phone}><Phone size={16} /> <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a></li>
          ))}
          <li><Mail size={16} /> <a href={`mailto:${orionRequisites.email}`}>{orionRequisites.email}</a></li>
          <li><MapPin size={16} /> {orionRequisites.address}</li>
        </ul>
        <div className={styles.contactNotes}>
          <span><ShieldCheck /> Работа по ППР и проекту</span>
          <span><Check /> Техника с экипажем</span>
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <label>Ваше имя<input required name="name" autoComplete="name" maxLength={100} /></label>
        <label>Телефон или e-mail<input required name="contact" autoComplete="email" maxLength={120} /></label>
        <label>О чём нужно поговорить?<textarea name="message" rows={4} maxLength={1500} placeholder="Тип объекта, сроки, технология или аренда техники" /></label>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className={styles.honeypot} />
        <label className={styles.consent}>
          <input required type="checkbox" name="consent" />
          <span>Согласен на обработку персональных данных для ответа на обращение.</span>
        </label>
        <button type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Отправляем…' : 'Отправить запрос'} <ArrowDownRight />
        </button>
        {state === 'sent' && (
          <p className={styles.formNotice} role="status">Заявка отправлена. Свяжемся с вами по указанному контакту.</p>
        )}
        {state === 'error' && (
          <p className={styles.formError} role="alert">Не удалось отправить. Позвоните нам по телефону выше или напишите на почту.</p>
        )}
      </form>
    </section>
  );
}

