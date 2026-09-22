'use client';

import { useEffect, useState } from 'react';
import { ArrowDownRight, Menu, X } from '@/components/piling/icons/unified-icons';
import {
  orionDigitalControl,
  orionDigitalControlIntro,
  orionProcessSteps,
  orionRequisites,
} from './orion-content';
import { OrionContact } from './orion-contact';
import { OrionFleet } from './orion-fleet';
import { OrionHero } from './orion-hero';
import styles from './orion-site.module.css';
import tender from './orion-tender.module.css';

const navigation = [
  ['Решения', '#solutions'],
  ['Парк техники', '#fleet'],
  ['Тендерная готовность', '#tender'],
  ['Контроль', '#control'],
  ['Истории объектов', '#stories'],
] as const;

const solutions = [
  ['01', 'Погружение свай', 'Подбор технологии по проекту, грунтам и ограничениям площадки.', 'Техника → контроль → исполнительные данные'],
  ['02', 'Лидерное бурение', 'Подготовка скважин в составе согласованной технологической последовательности.', 'Исходные данные → ППР → производство'],
  ['03', 'Шпунтовые работы', 'Решение уточняется по проекту и условиям объекта.', 'Проект → способ погружения → контроль'],
  ['04', 'Аренда с экипажем', 'Установка включается в производственный контур вместе с экипажем.', 'Паспорт → график → мобилизация'],
] as const;

const tenderEvidence = [
  ['01', 'Парк и паспорта', '8 единиц техники, русскоязычные PDF и ссылки на исходные документы.'],
  ['02', 'Работа по проекту и ППР', 'Технология уточняется после изучения исходных данных объекта.'],
  ['03', 'Аренда с экипажем', 'Запрос оценивается по составу техники, срокам и условиям мобилизации.'],
] as const;

const tenderInputs = [
  'Фрагмент проекта или ведомость свай',
  'Тип, сечение и проектная длина свай',
  'Адрес площадки и условия подъезда',
  'Требуемые даты начала и завершения',
] as const;

export function OrionSite() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  return (
    <main className={`${styles.site} ${tender.siteShell}`}>
      <a className={styles.skip} href="#content">{'Перейти к содержанию'}</a>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label={'ОРИОН — на главную'}>
          <span>{'ОРИОН'}</span><i>{'основания для больших проектов'}</i>
        </a>
        <nav className={styles.nav} aria-label={'Основная навигация'}>
          {navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <a className={styles.headerCta} href="#contact">
          {'Обсудить объект'} <ArrowDownRight size={17} />
        </a>
        <button
          className={styles.menuButton}
          type="button"
          aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={menuOpen}
          aria-controls="orion-mobile-nav"
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
        {menuOpen && (
          <nav className={styles.mobileNav} id="orion-mobile-nav" aria-label={'Мобильная навигация'}>
            {navigation.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}
            <a href="#contact" onClick={() => setMenuOpen(false)}>{'Обсудить объект'}</a>
          </nav>
        )}
      </header>

      <div id="content">
        <OrionHero />

        <section className={tender.qualification} aria-labelledby="qualification-title">
          <div className={tender.sectionIntro}>
            <p className={styles.kicker}>{'Квалификация подрядчика'}</p>
            <h2 id="qualification-title">{'Готовность к крупному подряду.'}</h2>
            <p>{'Проверяемые документы и понятная инженерная коммуникация важнее рекламных обещаний.'}</p>
          </div>
          <div className={tender.qualificationGrid}>
            {tenderEvidence.map(([number, title, copy]) => (
              <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>
            ))}
          </div>
        </section>

        <section className={tender.solutions} id="solutions">
          <div className={tender.sectionIntro}>
            <p className={styles.kicker}>{'Инженерная матрица'}</p>
            <h2>{'От задачи — к технологии.'}</h2>
            <p>{'Решение определяется проектом, грунтами, ограничениями площадки и графиком генподрядчика.'}</p>
          </div>
          <div className={tender.solutionRows}>
            {solutions.map(([number, title, copy, evidence]) => (
              <article className={tender.solutionRow} key={number}>
                <span>{number}</span><h3>{title}</h3><p>{copy}</p><p>{evidence}</p>
              </article>
            ))}
          </div>
        </section>

        <OrionFleet />

        <section className={tender.tender} id="tender" aria-labelledby="tender-title">
          <div className={tender.sectionIntro}>
            <p className={styles.kicker}>{'Тендерная готовность'}</p>
            <h2 id="tender-title">{'Данные для технической оценки — в одном контуре.'}</h2>
            <p>{'ОРИОН готовит проверяемый комплект по технике и уточняет решение после получения исходных данных.'}</p>
            <a className={tender.tenderCta} href="#contact">
              {'Получить тендерный пакет'} <ArrowDownRight aria-hidden="true" />
            </a>
          </div>
          <div className={tender.tenderColumns}>
            <article>
              <span>{'В комплекте'}</span>
              <ul>
                <li>{'Состав парка и назначение установок'}</li>
                <li>{'Русскоязычные PDF-карточки техники'}</li>
                <li>{'Ссылки на документы производителей'}</li>
                <li>{'Контакт для инженерного уточнения'}</li>
              </ul>
            </article>
            <article>
              <span>{'Для первичной оценки нужны'}</span>
              <ol>{tenderInputs.map((input) => <li key={input}>{input}</li>)}</ol>
            </article>
          </div>
        </section>

        <section className={styles.control} id="control">
          <div className={styles.controlIntro}>
            <p className={styles.kicker}>{'Цифровой контроль'}</p>
            <h2>{'Объект виден'}<br /><em>{'в производственных данных.'}</em></h2>
            <p>{orionDigitalControlIntro}</p>
          </div>
          <ul className={styles.controlGrid}>
            {orionDigitalControl.map((point) => (
              <li key={point.title}><h3>{point.title}</h3><p>{point.copy}</p></li>
            ))}
          </ul>
        </section>

        <section className={tender.stories} id="stories" aria-labelledby="stories-title">
          <div className={tender.sectionIntro}>
            <p className={styles.kicker}>{'Истории объектов'}</p>
            <h2 id="stories-title">{'Доказательства, а не рекламные кейсы.'}</h2>
            <p>{'Реальные фото и факты по объектам будут опубликованы после подтверждения компанией ОРИОН.'}</p>
          </div>
          <div className={tender.storyPanels}>
            <article className={tender.storyFormat}>
              <span>{'Формат будущей истории'}</span>
              <h3>{'Задача → решение → подтверждённый результат'}</h3>
              <p>{'Тип свай, технология, техника, сроки и объём публикуются только с подтверждающими материалами.'}</p>
            </article>
            <article className={tender.storyPending}>
              <span>{'Материалы готовятся'}</span>
              <h3>{'Место для реальных фотографий объекта'}</h3>
              <p>{'До загрузки материалов раздел не показывает названия заказчиков, объёмы или достижения.'}</p>
            </article>
          </div>
        </section>

        <section className={styles.process} id="process">
          <div className={styles.processIntro}>
            <p className={styles.kicker}>{'Процесс / 01—05'}</p>
            <h2>{'Предсказуемость начинается'} <em>{'до выхода на площадку.'}</em></h2>
            <p>{'Последовательность уточняется под проект. Сайт показывает порядок работы, а не обещает результат без изучения исходных данных.'}</p>
          </div>
          <ol className={styles.processSteps}>
            {orionProcessSteps.map((step) => (
              <li key={step.number}><span>{step.number}</span><div><h3>{step.title}</h3><p>{step.copy}</p></div></li>
            ))}
          </ol>
        </section>

        <OrionContact />
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerRequisites}>
          <strong>{orionRequisites.legalName}</strong>
          <span>{`ИНН ${orionRequisites.inn} · КПП ${orionRequisites.kpp}`}</span>
          <span>{orionRequisites.address}</span>
          <span>
            {orionRequisites.phones.map((phone, index) => (
              <span key={phone}>
                {index > 0 && ', '}
                <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>
              </span>
            ))}
          </span>
          <a href={`mailto:${orionRequisites.email}`}>{orionRequisites.email}</a>
        </div>
        <div className={styles.footerBottom}>
          <span>{'© ОРИОН · свайные работы и аренда техники'}</span>
          <a href="#top">{'Наверх ↑'}</a>
        </div>
      </footer>
    </main>
  );
}

