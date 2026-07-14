'use client';

import { useState } from 'react';
import { ArrowDownRight, Check, ChevronRight, FileText, HardHat, Menu, ShieldCheck, X } from 'lucide-react';
import { orionCapabilities, orionEquipment, orionStories } from './orion-content';
import styles from './orion-site.module.css';

const navigation = [
  ['Компетенции', '#capabilities'], ['Парк техники', '#fleet'], ['Истории объектов', '#stories'], ['Безопасность', '#safety'],
] as const;

export function OrionSite() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [formState, setFormState] = useState<'idle' | 'success'>('idle');
  const [activePhotos, setActivePhotos] = useState<Record<string, number>>({});

  return (
    <main className={styles.site}>
      <a className={styles.skip} href="#content">Перейти к содержанию</a>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="ОРИОН — на главную"><span>ОРИОН</span><i>основания для больших проектов</i></a>
        <nav className={styles.nav} aria-label="Основная навигация">{navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
        <a className={styles.headerCta} href="#contact">Обсудить объект <ArrowDownRight size={17} /></a>
        <button className={styles.menuButton} type="button" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X /> : <Menu />}</button>
        {menuOpen && <nav className={styles.mobileNav} aria-label="Мобильная навигация">{navigation.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}<a href="#contact" onClick={() => setMenuOpen(false)}>Обсудить объект</a></nav>}
      </header>

      <div id="content">
        <section className={styles.hero} id="top">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>Свайные работы · аренда установок · Россия</p>
            <h1>Свайные работы,<br /><em>на которых</em> держатся большие проекты.</h1>
            <p className={styles.lead}>ОРИОН берёт в работу фундаментную задачу целиком: от оценки исходных данных до выхода собственной техники и бригады на объект.</p>
            <div className={styles.actions}><a className={styles.primaryButton} href="#contact">Обсудить объект <ArrowDownRight /></a><a className={styles.secondaryButton} href="#fleet">Смотреть парк <ChevronRight /></a></div>
          </div>
          <div className={styles.heroVisual}>
            <img src="/icons/equipment-photos/rtg-rm20.jpg" alt="Буровая установка Bauer RTG RM20 на объекте" />
            <p className={styles.photoLabel}>Собственный парк<br /><strong>8 установок</strong></p>
          </div>
        </section>

        <section className={styles.proof} aria-label="Ключевые преимущества">
          <div><strong>8</strong><span>единиц в парке</span></div><div><strong>01</strong><span>единый инженерный контур</span></div><div><strong>ППР</strong><span>работаем по проекту и регламенту</span></div><div><strong>24/7</strong><span>готовность к производственному графику</span></div>
        </section>

        <section className={styles.capabilities} id="capabilities">
          <div className={styles.sectionHeading}><p className={styles.kicker}>Компетенции</p><h2>Техника важна.<br />Но результат определяет <em>система работ.</em></h2></div>
          <div className={styles.capabilityGrid}>{orionCapabilities.map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p><ArrowDownRight aria-hidden="true" /></article>)}</div>
        </section>

        <section className={styles.fleet} id="fleet">
          <div className={styles.sectionHeading}><p className={styles.kicker}>Парк техники</p><h2>Своя техника.<br /><em>Свой контроль.</em></h2><p>Восемь установок под разные технологические задачи. Каждая карточка — часть живого парка, а не иллюстрация из каталога.</p></div>
          <div className={styles.fleetGrid}>{orionEquipment.map((equipment, index) => {
            const activeIndex = activePhotos[equipment.name] ?? 0;
            const activePhoto = equipment.photos[activeIndex] ?? equipment.photos[0];

            return <article className={styles.machine} key={equipment.name}>
              <div className={styles.machineImage}>
                <img src={activePhoto.src} alt={activePhoto.alt} loading={index > 1 ? 'lazy' : undefined} />
                <b>0{index + 1}</b>
                <span className={styles.photoCount}>{equipment.photos.length}/{equipment.photoSlots} проверено фото</span>
              </div>
              <div className={styles.machineThumbs} aria-label={`Фотографии ${equipment.name}`}>
                {Array.from({ length: equipment.photoSlots }, (_, photoIndex) => {
                  const photo = equipment.photos[photoIndex];
                  return photo ? <button
                    aria-label={`Показать фото ${photoIndex + 1} — ${equipment.name}`}
                    aria-pressed={activeIndex === photoIndex}
                    className={activeIndex === photoIndex ? styles.activeThumb : undefined}
                    key={photo.src}
                    onClick={() => setActivePhotos((current) => ({ ...current, [equipment.name]: photoIndex }))}
                    type="button"
                  ><img src={photo.src} alt="" loading="lazy" /></button> : <span className={styles.pendingThumb} key={`pending-${photoIndex}`}><HardHat size={13} /><i>ожидает</i></span>;
                })}
              </div>
              <div className={styles.machineBody}>
                <p>{equipment.category}</p><h3>{equipment.name}</h3><span>{equipment.summary}</span>
                <a href={activePhoto.sourceUrl} target="_blank" rel="noreferrer">{activePhoto.credit} · источник <ArrowDownRight size={14} /></a>
              </div>
            </article>;
          })}</div>
        </section>

        <section className={styles.stories} id="stories">
          <div><p className={styles.kicker}>Истории объектов</p><h2>Работа должна<br />оставлять <em>доказательства.</em></h2></div>
          {orionStories.length === 0 && <div className={styles.emptyStory}><FileText size={28} /><h3>Готовим портфолио реализованных объектов</h3><p>Здесь появятся реальные истории: задача, технология, техника, этапы и итог работ. Пока можно запросить референсы у команды ОРИОН.</p><a href="#contact">Запросить референсы <ArrowDownRight size={16} /></a></div>}
        </section>

        <section className={styles.safety} id="safety"><div className={styles.safetyVisual}><span>ПРОЦЕСС / 01—05</span></div><div><p className={styles.kicker}>Безопасность и процесс</p><h2>Предсказуемость начинается <em>до выхода на площадку.</em></h2><ol><li><span>01</span>Изучаем исходные данные и условия объекта.</li><li><span>02</span>Согласовываем технологию, состав техники и график.</li><li><span>03</span>Выводим экипаж с понятными зонами ответственности.</li><li><span>04</span>Ведём работы по ППР и производственному контролю.</li><li><span>05</span>Передаём результат с исполнительной документацией.</li></ol></div></section>

        <section className={styles.contact} id="contact"><div><p className={styles.kicker}>Тендерный отдел</p><h2>Начнём с<br /><em>вашего объекта.</em></h2><p>Оставьте контакты и кратко опишите задачу. Инженер ОРИОН вернётся с уточняющими вопросами и следующим шагом.</p><div className={styles.contactNotes}><span><ShieldCheck /> Работаем по ППР и проекту</span><span><Check /> Без подмены техники и условий</span></div></div><form onSubmit={(event) => { event.preventDefault(); setFormState('success'); }}><label>Ваше имя<input required name="name" autoComplete="name" /></label><label>Телефон или e-mail<input required name="contact" autoComplete="email" /></label><label>О чём нужно поговорить?<textarea name="message" rows={4} placeholder="Тип объекта, сроки, технология или аренда техники" /></label><button type="submit">Отправить запрос <ArrowDownRight /></button>{formState === 'success' && <p className={styles.success} role="status">Запрос принят. Команда ОРИОН свяжется с вами для уточнения вводных.</p>}</form></section>
      </div>
      <footer className={styles.footer}><span>© ОРИОН · свайные работы и аренда техники</span><a href="#top">Наверх ↑</a></footer>
    </main>
  );
}
