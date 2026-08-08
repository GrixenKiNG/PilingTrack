'use client';

import Image from 'next/image';
import { FormEvent, KeyboardEvent, useEffect, useState } from 'react';
import { orionEquipment, orionGeneralEquipment, orionProcessSteps, orionRequisites } from './orion-content';
import { OrionCinematicGallery } from './orion-cinematic-gallery';
import { orionEquipmentProfiles } from './orion-equipment-profiles';
import styles from './orion-handoff-site.module.css';
import editorial from './orion-editorial.module.css';

const navigation = [
  ['Услуги', '#services'], ['Парк', '#fleet'], ['Истории объектов', '#projects'],
  ['Процесс', '#process'], ['О компании', '#about'], ['FAQ', '#faq'], ['Контакты', '#contact'],
] as const;

const services = [
  ['01', 'Забивка свай', 'Подбор установки и молота под проектные параметры, грунты и ограничения площадки.'],
  ['02', 'Вибропогружение', 'Погружение и извлечение шпунта и свай с управляемой технологической последовательностью.'],
  ['03', 'Буровые работы', 'Бурение под свайные основания и подготовка скважин для сложных грунтовых условий.'],
  ['04', 'Лидерное бурение', 'Снижение сопротивления грунта и точная подготовка положения сваи по проекту.'],
  ['05', 'Шпунтовые ограждения', 'Устройство временных и постоянных ограждений котлованов по согласованной технологии.'],
  ['06', 'Аренда с экипажем', 'Установка, оператор и инженерное сопровождение для предсказуемой мобилизации.'],
] as const;

const sectors = [
  ['01', 'Жилое строительство', 'Фундаменты в плотной городской среде и рядом с существующей застройкой.'],
  ['02', 'Промышленность', 'Основания под производственные здания, инженерные сооружения и оборудование.'],
  ['03', 'Мосты и транспорт', 'Свайные решения для опор, подходов и транспортной инфраструктуры.'],
  ['04', 'Инфраструктура', 'Объекты общественного назначения и сложные площадки по России.'],
] as const;

const proof = [
  ['8', 'единиц подтверждённого парка'],
  ['ППР', 'работа по проекту'],
  ['Экипаж', 'аренда с оператором'],
  ['PDF', 'русскоязычные карточки техники'],
] as const;

const faq = [
  ['Как получить предварительный расчёт?', 'Пришлите фрагмент проекта или ведомость свай, адрес площадки и желаемые сроки. Инженер уточнит недостающие данные.'],
  ['В каких регионах работает ОРИОН?', 'База компании находится в Чебоксарах. Возможность мобилизации по России подтверждается после оценки техники, маршрута и графика.'],
  ['Работаете ли вы зимой и в сложных грунтах?', 'Технология и состав техники определяются после изучения проекта, инженерно-геологических данных и условий площадки.'],
  ['Можно арендовать установку с оператором?', 'Да. Запрос оценивается по типу работ, срокам, комплектации и условиям мобилизации.'],
  ['Какие документы получает заказчик?', 'Состав документов фиксируется договором и ППР. Для технической оценки доступны карточки и источники характеристик техники.'],
] as const;

const engineeringStories = [
  {
    number: '01',
    kicker: 'Геология → технология',
    title: 'От геологии — к рабочей технологии.',
    copy: 'Инженерно-геологические данные, проект и ограничения площадки превращаются в технологическую карту, состав техники и контрольные точки.',
    image: '/orion-engineering-strata.webp',
    alt: 'Инженерный разрез грунта со свайным полем и отметками контроля',
  },
  {
    number: '02',
    kicker: 'Логистика → мобилизация',
    title: 'От маршрута — к безопасной расстановке.',
    copy: 'До выхода техники проверяем подъезд, площадку, зоны работы, последовательность доставки и готовность к монтажу.',
    image: '/orion/visuals/mobilization-site.webp',
    alt: 'Схема мобилизации сваебойной установки и организации строительной площадки',
  },
  {
    number: '03',
    kicker: 'Осмотр → допуск',
    title: 'От осмотра — к подтверждённой техготовности.',
    copy: 'Оператор фиксирует состояние установки, моточасы и замечания. Дефект получает статус, ответственного и маршрут к диспетчеру.',
    image: '/orion/visuals/technical-readiness.webp',
    alt: 'Техническая схема проверки готовности буровой установки и её узлов',
  },
  {
    number: '04',
    kicker: 'Производство → контроль',
    title: 'От погружения — к измеримому результату.',
    copy: 'Производственные операции связываются с проектными отметками, фактическими параметрами и контрольными событиями смены.',
    image: '/orion/visuals/production-control.webp',
    alt: 'Схема контроля свайного поля с установкой, графиками и контрольными точками',
  },
  {
    number: '05',
    kicker: 'Факт → документы',
    title: 'От полевого факта — к исполнительной документации.',
    copy: 'Фото, измерения, геодезические отметки и журнал работ собираются в проверяемый пакет без повторного ручного ввода.',
    image: '/orion/visuals/as-built-documentation.webp',
    alt: 'Исполнительная схема свайного поля с листами документации и карточками доказательств',
  },
  {
    number: '06',
    kicker: 'PilingTrack → решение',
    title: 'От смены оператора — к управленческому решению.',
    copy: 'Осмотр, моточасы, дефект, передача диспетчеру, ремонт и отчёт остаются одной прослеживаемой цифровой цепочкой.',
    image: '/orion/visuals/pilingtrack-digital-loop.webp',
    alt: 'Цифровой контур PilingTrack от оператора и дефекта до диспетчера, ремонта и отчёта',
  },
] as const;

type LeadState = {
  service: string; task: string; city: string; timeline: string; file: string;
  name: string; phone: string; email: string; consent: boolean; website: string;
};

const initialLead: LeadState = {
  service: '', task: '', city: '', timeline: '', file: '', name: '', phone: '', email: '',
  consent: false, website: '',
};

export function OrionHandoffSite() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFleet, setActiveFleet] = useState(0);
  const [step, setStep] = useState(0);
  const [lead, setLead] = useState(initialLead);
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  const equipment = orionEquipment[activeFleet];
  const profile = orionEquipmentProfiles[equipment.profileKey];

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  function selectFleet(index: number) {
    setActiveFleet((index + orionEquipment.length) % orionEquipment.length);
  }

  function onFleetKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') selectFleet(0);
    else if (event.key === 'End') selectFleet(orionEquipment.length - 1);
    else selectFleet(index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1));
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lead.consent || !lead.name || (!lead.phone && !lead.email)) {
      setSubmitState('error');
      return;
    }
    setSubmitState('sending');
    const message = [
      lead.service && 'Услуга: ' + lead.service,
      lead.task && 'Задача: ' + lead.task,
      lead.city && 'Город: ' + lead.city,
      lead.timeline && 'Сроки: ' + lead.timeline,
      lead.file && 'Файл для последующей передачи: ' + lead.file,
    ].filter(Boolean).join('\n');
    try {
      const response = await fetch('/api/orion/lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: lead.name, contact: [lead.phone, lead.email].filter(Boolean).join(' / '),
          message, consent: lead.consent, website: lead.website,
        }),
      });
      if (!response.ok) throw new Error('lead');
      setSubmitState('done');
    } catch {
      setSubmitState('error');
    }
  }

  const setField = <K extends keyof LeadState>(field: K, value: LeadState[K]) =>
    setLead((current) => ({ ...current, [field]: value }));

  return (
    <main className={styles.site}>
      <a className={styles.skipLink} href="#main-content">Перейти к содержанию</a>
      <div className={styles.scrollProgress} aria-hidden="true" />
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="ОРИОН — на главную"><i />ОРИОН</a>
        <nav className={styles.nav} aria-label="Основная навигация">
          {navigation.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.phone} href={'tel:' + orionRequisites.phones[2].replace(/[^+\d]/g, '')}>{orionRequisites.phones[2]}</a>
          <a className={styles.headerCta} href="#contact">Заявка</a>
        </div>
        <button className={styles.menuButton} type="button" aria-expanded={menuOpen}
          aria-controls="orion-handoff-menu" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
          onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? '×' : '≡'}</button>
        {menuOpen && <nav className={styles.mobileNav} id="orion-handoff-menu" aria-label="Мобильная навигация">
          {navigation.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        </nav>}
      </header>

      <div id="main-content">
        <section className={styles.hero} id="top">
          <Image className={styles.heroImage} src={orionEquipment[0].photos[0].src}
            alt="" fill loading="eager" fetchPriority="high" sizes="100vw" />
          <div className={styles.heroOverlay} />
          <div className={styles.heroGrid} aria-hidden="true" />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>СВАЙНЫЕ РАБОТЫ · АРЕНДА ТЕХНИКИ</p>
            <h1><span>Основания</span><span>для больших</span><span>проектов.</span></h1>
            <p className={styles.heroLead}>Собственный парк, инженерная дисциплина и контроль производства — от исходных данных до исполнительной документации.</p>
            <div className={styles.heroButtons}>
              <a className={styles.primaryButton} href="#contact">Обсудить объект <span>↘</span></a>
              <a className={styles.secondaryButton} href="#fleet">Выбрать технику <span>↓</span></a>
            </div>
          </div>
          <p className={styles.heroCredit}>Фото-референс модели · {orionEquipment[0].photos[0].credit}</p>
        </section>

        <section className={styles.proofBand} aria-label="Ключевые сведения">
          {proof.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
        </section>

        <section className={styles.statement}>
          <p className={styles.sectionLabel}>// ПОЗИЦИОНИРОВАНИЕ</p>
          <h2>Мы не подрядчик на подхвате. <em>Собственный парк, инженерная дисциплина и ответственность за производственный контур.</em></h2>
        </section>

        <OrionCinematicGallery />

        <section className={styles.section} id="services">
          <div className={styles.sectionHeading}><p className={styles.sectionLabel}>01 / УСЛУГИ</p><h2>Технология под задачу, а не наоборот.</h2></div>
          <div className={styles.serviceGrid}>
            {services.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><p className={styles.sectionLabel}>02 / СФЕРЫ ПРИМЕНЕНИЯ</p><h2>Работаем там, где основание определяет весь график.</h2></div>
          <div className={styles.sectorGrid}>
            {sectors.map(([number, title, copy]) => <article key={number}><strong>{number}</strong><div><h3>{title}</h3><p>{copy}</p></div></article>)}
          </div>
        </section>

        <section className={styles.section} id="fleet">
          <div className={styles.sectionHeading}><p className={styles.sectionLabel}>03 / ПАРК ТЕХНИКИ</p><h2>Восемь установок. Один инженерный контур.</h2></div>
          <div className={styles.fleetExplorer}>
            <div className={styles.fleetTabs} role="tablist" aria-label="Установки ОРИОН" aria-orientation="vertical">
              {orionEquipment.map((item, index) => <button key={item.name} type="button" role="tab"
                aria-selected={activeFleet === index} tabIndex={activeFleet === index ? 0 : -1}
                className={activeFleet === index ? styles.activeFleetTab : undefined}
                onClick={() => selectFleet(index)} onKeyDown={(event) => onFleetKeyDown(event, index)}>
                <span>{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><small>{item.category}</small>
              </button>)}
            </div>
            <div className={styles.fleetDetail} role="tabpanel">
              <div className={styles.fleetMedia}>
                <Image key={equipment.name} src={equipment.photos[0].src} alt={equipment.photos[0].alt}
                  fill sizes="(max-width: 900px) 100vw, 48vw" />
                <span className={styles.availability}>В ПАРКЕ ОРИОН</span>
                <small>Фото модели · {equipment.photos[0].credit}</small>
              </div>
              <div className={styles.fleetSpecs}>
                <p className={styles.sectionLabel}>{equipment.category}</p>
                <h3>{equipment.name}</h3>
                <p>{equipment.summary}</p>
                <dl>{profile.specifications.slice(0, 5).map((spec) => <div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl>
                <p className={styles.disclaimer}>{profile.disclaimer}</p>
                <a className={styles.primaryButton} href="#contact">Запросить доступность <span>↘</span></a>
              </div>
            </div>
          </div>
          <div className={styles.generalFleet}>
            <p className={styles.sectionLabel}>ЗЕМЛЕРОЙНАЯ ТЕХНИКА</p>
            <div>{orionGeneralEquipment.map((unit, index) => <article key={unit.name}><span>0{index + 1}</span><h3>{unit.name}</h3><p>{unit.role}</p></article>)}</div>
          </div>
        </section>

        <section className={styles.section} id="projects">
          <div className={styles.sectionHeading}>
            <p className={styles.sectionLabel}>04 / ИСТОРИИ ОБЪЕКТОВ</p>
            <h2>Только реальные объекты и подтверждённые результаты.</h2>
            <p>Раздел подготовлен к публикации. Названия заказчиков, фотографии, объёмы и сроки появятся после проверки и согласования материалов компанией ОРИОН.</p>
          </div>
          <div className={styles.storyBlueprint}>
            <article><span>01</span><h3>Исходные данные</h3><p>Тип объекта, город, проектная задача и условия площадки.</p></article>
            <article><span>02</span><h3>Производство</h3><p>Состав техники, технология, этапы работ и реальные фотографии.</p></article>
            <article><span>03</span><h3>Подтверждённый результат</h3><p>Фактический объём, сроки и исполнительные материалы — без рекламных допущений.</p></article>
          </div>
        </section>

        <section className={styles.section} id="process">
          <div className={styles.sectionHeading}><p className={styles.sectionLabel}>05 / КАК МЫ РАБОТАЕМ</p><h2>Предсказуемость начинается до выхода на площадку.</h2></div>
          <ol className={styles.processGrid}>{orionProcessSteps.map((item) => <li key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.copy}</p></li>)}</ol>
        </section>


        <section className={editorial.engineeringStories} aria-labelledby="engineering-stories-title">
          <div className={styles.sectionHeading}>
            <p className={styles.sectionLabel}>06 / ИНЖЕНЕРНЫЙ КОНТУР</p>
            <h2 id="engineering-stories-title">От исходных данных — к доказуемому результату.</h2>
            <p>Шесть связанных этапов показывают не отдельные услуги, а управляемую производственную систему ORION и PilingTrack.</p>
          </div>
          <div className={editorial.storyList}>
            {engineeringStories.map((story, index) => (
              <article className={editorial.story} key={story.number}>
                <div className={editorial.storyMedia}>
                  <Image src={story.image} alt={story.alt} fill sizes="(max-width: 900px) 100vw, 58vw" />
                </div>
                <div className={editorial.storyCopy}>
                  <span>{story.number}</span>
                  <p>{story.kicker}</p>
                  <h3>{story.title}</h3>
                  <p>{story.copy}</p>
                  <small>{index === 5 ? 'Цифровой производственный контур' : 'Инженерный этап проекта'}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className={styles.about} id="about">
          <div className={styles.aboutMedia}><Image src={orionEquipment[1].photos[0].src} alt={orionEquipment[1].photos[0].alt} fill sizes="(max-width: 800px) 100vw, 42vw" /><span>ОРИОН</span></div>
          <div className={styles.aboutCopy}><p className={styles.sectionLabel}>07 / О КОМПАНИИ</p><h2>Инженерная уверенность подтверждается системой.</h2>
            <p>ООО «ОРИОН» выполняет свайные работы и предоставляет тяжёлую технику с экипажем. База компании — Чебоксары, география запросов — Россия.</p>
            <p>Технология уточняется по проекту, геологии, площадке и графику. Производственные данные фиксируются в PilingTrack.</p>
            <div className={styles.capabilities}>{['Собственный парк', 'Работа по ППР', 'Контроль производства', 'Паспорта техники'].map((item) => <span key={item}>{item}</span>)}</div>
          </div>
        </section>

        <section className={styles.evidence}>
          <div className={styles.sectionHeading}><p className={styles.sectionLabel}>08 / ДОКАЗАТЕЛЬНАЯ БАЗА</p><h2>Не отзывы вместо фактов, а проверяемые материалы.</h2></div>
          <div>{[['01', 'Паспорта техники', 'Русскоязычные карточки и ссылки на документы производителей.'], ['02', 'ППР и контроль', 'Состав работ и контрольные точки фиксируются до мобилизации.'], ['03', 'PilingTrack', 'Смены, объёмы, фото и состояние техники собираются в цифровом контуре.']].map(([n,t,c]) => <article key={n}><span>{n}</span><h3>{t}</h3><p>{c}</p></article>)}</div>
        </section>

        <section className={styles.faq} id="faq">
          <div className={styles.sectionHeading}><p className={styles.sectionLabel}>09 / ВОПРОСЫ И ОТВЕТЫ</p><h2>До расчёта — только честные вводные.</h2></div>
          <div>{faq.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div>
        </section>

        <section className={styles.contact} id="contact">
          <div className={styles.contactInfo}><p className={styles.sectionLabel}>10 / КОНТАКТЫ</p><h2>Начнём с исходных данных.</h2><p>Пришлите задачу, город и сроки. Инженер уточнит технологию и состав техники после проверки вводных.</p>
            <dl><div><dt>ТЕЛЕФОН</dt><dd>{orionRequisites.phones.map((phone) => <a key={phone} href={'tel:' + phone.replace(/[^+\d]/g, '')}>{phone}</a>)}</dd></div>
              <div><dt>EMAIL</dt><dd><a href={'mailto:' + orionRequisites.email}>{orionRequisites.email}</a></dd></div>
              <div><dt>АДРЕС</dt><dd>{orionRequisites.address}</dd></div></dl>
          </div>
          <form className={styles.leadForm} onSubmit={submitLead}>
            {submitState === 'done' ? <div className={styles.success} role="status"><span>✓</span><h3>Заявка принята</h3><p>Свяжемся по указанному контакту и уточним исходные данные.</p></div> : <>
              <div className={styles.formProgress}><div><b>ШАГ {step + 1} / 4</b><span>{['Задача', 'Город и сроки', 'Проект', 'Контакты'][step]}</span></div><i><span style={{ transform: `scaleX(${(step + 1) / 4})` }} /></i></div>
              {step === 0 && <fieldset><legend>Какая задача стоит на объекте?</legend><div className={styles.serviceChips}>{services.map(([, title]) => <button type="button" key={title} aria-pressed={lead.service === title} onClick={() => setField('service', title)}>{title}</button>)}</div><label>Кратко опишите задачу<textarea value={lead.task} onChange={(e) => setField('task', e.target.value)} maxLength={800} /></label></fieldset>}
              {step === 1 && <fieldset><legend>Где и когда планируются работы?</legend><label>Город или регион<input value={lead.city} onChange={(e) => setField('city', e.target.value)} /></label><label>Желаемые сроки<input value={lead.timeline} onChange={(e) => setField('timeline', e.target.value)} placeholder="Например: август — сентябрь" /></label></fieldset>}
              {step === 2 && <fieldset><legend>Есть проект или ведомость?</legend><label className={styles.fileZone}>↑<span>{lead.file || 'Выберите файл — его название попадёт в заявку'}</span><small>Сам файл инженер запросит безопасным каналом после контакта.</small><input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" onChange={(e) => setField('file', e.target.files?.[0]?.name || '')} /></label></fieldset>}
              {step === 3 && <fieldset><legend>Куда ответить?</legend><label>Имя<input required value={lead.name} onChange={(e) => setField('name', e.target.value)} autoComplete="name" /></label><label>Телефон<input value={lead.phone} onChange={(e) => setField('phone', e.target.value)} autoComplete="tel" inputMode="tel" /></label><label>Email<input type="email" value={lead.email} onChange={(e) => setField('email', e.target.value)} autoComplete="email" /></label><label className={styles.consent}><input type="checkbox" checked={lead.consent} onChange={(e) => setField('consent', e.target.checked)} />Согласен на обработку данных для ответа на заявку</label><input className={styles.honeypot} tabIndex={-1} aria-hidden="true" value={lead.website} onChange={(e) => setField('website', e.target.value)} /></fieldset>}
              {submitState === 'error' && <p className={styles.formError} role="alert">Проверьте имя, контакт и согласие или свяжитесь с нами напрямую.</p>}
              <div className={styles.formNav}>{step > 0 && <button type="button" onClick={() => { setStep((value) => value - 1); setSubmitState('idle'); }}>Назад</button>}<button className={styles.nextButton} type={step === 3 ? 'submit' : 'button'} disabled={submitState === 'sending'} onClick={step < 3 ? () => setStep((value) => value + 1) : undefined}>{submitState === 'sending' ? 'Отправляем…' : step === 3 ? 'Отправить' : 'Далее'}</button></div>
            </>}
          </form>
        </section>
      </div>

      <footer className={styles.footer}><div><a className={styles.brand} href="#top"><i />ОРИОН</a><p>Свайные работы полного цикла и аренда тяжёлой техники с экипажем.</p></div><div><strong>Разделы</strong>{navigation.slice(0, 5).map(([label, href]) => <a key={href} href={href}>{label}</a>)}</div><div><strong>Контакты</strong><a href={'mailto:' + orionRequisites.email}>{orionRequisites.email}</a><a href={'tel:' + orionRequisites.phones[2].replace(/[^+\d]/g, '')}>{orionRequisites.phones[2]}</a></div><p>© ОРИОН · ИНН {orionRequisites.inn} · КПП {orionRequisites.kpp}</p></footer>
      <div className={styles.mobileActions}><a href={'tel:' + orionRequisites.phones[2].replace(/[^+\d]/g, '')}>Позвонить</a><a href="#contact">Заявка</a></div>
    </main>
  );
}
