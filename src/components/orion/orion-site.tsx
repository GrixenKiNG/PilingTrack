'use client';

import { useEffect, useState } from 'react';
import { ArrowDownRight, Menu, X } from '@/components/piling/icons/unified-icons';
import {
  orionCapabilities,
  orionClients,
  orionCompanyFacts,
  orionCompanyIntro,
  orionDigitalControl,
  orionDigitalControlIntro,
  orionGeneralEquipment,
  orionObjects,
  orionProcessSteps,
  orionRequisites,
} from './orion-content';
import { OrionContact } from './orion-contact';
import { OrionFleet } from './orion-fleet';
import { OrionHero } from './orion-hero';
import styles from './orion-site.module.css';

const navigation = [
  ['О компании', '#about'],
  ['Компетенции', '#capabilities'],
  ['Парк техники', '#fleet'],
  ['Контроль', '#control'],
  ['Объекты', '#stories'],
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
    <main className={styles.site}>
      <a className={styles.skip} href="#content">Перейти к содержанию</a>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="ОРИОН — на главную"><span>ОРИОН</span><i>основания для больших проектов</i></a>
        <nav className={styles.nav} aria-label="Основная навигация">{navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
        <a className={styles.headerCta} href="#contact">Обсудить объект <ArrowDownRight size={17} /></a>
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
          <nav className={styles.mobileNav} id="orion-mobile-nav" aria-label="Мобильная навигация">
            {navigation.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
            <a href="#contact" onClick={() => setMenuOpen(false)}>Обсудить объект</a>
          </nav>
        )}
      </header>

      <div id="content">
        <OrionHero />

        <section className={styles.about} id="about">
          <div className={styles.aboutCopy}>
            <p className={styles.kicker}>О компании</p>
            <h2>Строительная компания<br /><em>полного цикла.</em></h2>
            <p>{orionCompanyIntro}</p>
          </div>
          <dl className={styles.aboutFacts}>
            {orionCompanyFacts.map((fact) => (
              <div key={fact.label}><dt>{fact.value}</dt><dd>{fact.label}</dd></div>
            ))}
          </dl>
        </section>

        <section className={styles.capabilities} id="capabilities">
          <div className={styles.sectionHeading}>
            <p className={styles.kicker}>Компетенции</p>
            <h2>Техника важна.<br />Результат определяет <em>система работ.</em></h2>
          </div>
          <div className={styles.capabilityGrid}>
            {orionCapabilities.map(([number, title, copy]) => (
              <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p><ArrowDownRight aria-hidden="true" /></article>
            ))}
          </div>
        </section>

        <OrionFleet />

        <section className={styles.generalFleet} aria-label="Общестроительная техника">
          <p className={styles.kicker}>Общестроительная техника</p>
          <ul>
            {orionGeneralEquipment.map((unit) => (
              <li key={unit.name}><strong>{unit.name}</strong><span>{unit.role}</span></li>
            ))}
          </ul>
        </section>

        <section className={styles.control} id="control">
          <div className={styles.controlIntro}>
            <p className={styles.kicker}>Цифровой контроль</p>
            <h2>Каждая свая —<br /><em>под контролем.</em></h2>
            <p>{orionDigitalControlIntro}</p>
          </div>
          <ul className={styles.controlGrid}>
            {orionDigitalControl.map((point) => (
              <li key={point.title}><h3>{point.title}</h3><p>{point.copy}</p></li>
            ))}
          </ul>
        </section>

        <section className={styles.stories} id="stories">
          <div>
            <p className={styles.kicker}>Объекты</p>
            <h2>Работа оставляет<br /><em>доказательства.</em></h2>
            <p className={styles.storiesLead}>Объекты гражданского и промышленного строительства, в которых участвовала компания.</p>
          </div>
          <ul className={styles.objectGrid}>
            {orionObjects.map((object, index) => (
              <li key={object.title}>
                <span className={styles.objectPhoto} aria-hidden="true">
                  {object.image
                    ? <img src={object.image} alt="" loading="lazy" />
                    : <span className={styles.objectPhotoEmpty}>фото готовится</span>}
                </span>
                <span className={styles.objectIndex}>{String(index + 1).padStart(2, '0')}</span>
                <h3>{object.title}</h3>
                <p>{object.kind}</p>
              </li>
            ))}
          </ul>

          <div className={styles.clients}>
            <p className={styles.kicker}>Клиенты</p>
            <ul>
              {orionClients.map((client) => <li key={client}>{client}</li>)}
            </ul>
          </div>
        </section>

        <section className={styles.process} id="process">
          <div className={styles.processIntro}>
            <p className={styles.kicker}>Процесс / 01—05</p>
            <h2>Предсказуемость начинается <em>до выхода на площадку.</em></h2>
            <p>Последовательность уточняется под проект. Сайт показывает порядок работы, а не обещает результат без изучения исходных данных.</p>
          </div>
          <ol className={styles.processSteps}>
            {orionProcessSteps.map((step) => (
              <li key={step.number}>
                <span>{step.number}</span>
                <div><h3>{step.title}</h3><p>{step.copy}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <OrionContact />
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerRequisites}>
          <strong>{orionRequisites.legalName}</strong>
          <span>ИНН {orionRequisites.inn} · КПП {orionRequisites.kpp}</span>
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
          <span>© ОРИОН · свайные работы и аренда техники</span>
          <a href="#top">Наверх ↑</a>
        </div>
      </footer>
    </main>
  );
}

