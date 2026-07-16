'use client';

import { useEffect, useState } from 'react';
import { ArrowDownRight, FileText, Menu, X } from '@/components/piling/icons/unified-icons';
import { orionCapabilities, orionProcessSteps, orionStories } from './orion-content';
import { OrionContact } from './orion-contact';
import { OrionFleet } from './orion-fleet';
import { OrionHero } from './orion-hero';
import styles from './orion-site.module.css';

const navigation = [
  ['Компетенции', '#capabilities'],
  ['Парк техники', '#fleet'],
  ['Истории объектов', '#stories'],
  ['Процесс', '#process'],
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

        <section className={styles.stories} id="stories">
          <div>
            <p className={styles.kicker}>Истории объектов</p>
            <h2>Работа должна<br />оставлять <em>доказательства.</em></h2>
          </div>
          {orionStories.length === 0 && (
            <div className={styles.emptyStory}>
              <FileText size={28} />
              <span className={styles.emptyIndex}>Портфолио / готовится</span>
              <h3>Готовим портфолио реализованных объектов</h3>
              <p>Здесь появятся только реальные истории: задача, технология, техника, этапы и подтверждённый итог работ.</p>
              <a href="#contact">Запросить референсы <ArrowDownRight size={16} /></a>
            </div>
          )}
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

      <footer className={styles.footer}><span>© ОРИОН · свайные работы и аренда техники</span><a href="#top">Наверх ↑</a></footer>
    </main>
  );
}

