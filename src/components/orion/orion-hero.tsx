import { ArrowDownRight, ChevronRight } from 'lucide-react';
import { orionProofPoints } from './orion-content';
import styles from './orion-site.module.css';

export function OrionHero() {
  return (
    <>
      <section className={styles.hero} id="top">
        <div className={styles.heroMedia} aria-hidden="true">
          <img src="/icons/equipment-photos/rtg-rm20.jpg" alt="" />
        </div>
        <div className={styles.heroScrim} />
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Свайные работы · аренда установок с экипажем</p>
          <h1>Свайные работы,<br /><em>на которых</em> держатся большие проекты.</h1>
          <p className={styles.lead}>ОРИОН подбирает технологию, технику и последовательность работ под исходные данные, ППР и график объекта.</p>
          <div className={styles.actions}>
            <a className={styles.primaryButton} href="#contact">Обсудить объект <ArrowDownRight /></a>
            <a className={styles.secondaryButton} href="#fleet">Смотреть парк <ChevronRight /></a>
          </div>
        </div>
        <div className={styles.heroReference}>
          <span>Bauer RTG RM20 · референс модели</span>
          <a href="https://geomek.se/en/foundations/machines/bauer-rtg/" target="_blank" rel="noreferrer">Источник ↗</a>
        </div>
        <a className={styles.scrollCue} href="#proof"><span>Прокрутить</span><i /></a>
      </section>

      <section className={styles.proof} id="proof" aria-label="Подтверждённые сведения">
        {orionProofPoints.map((point) => <div key={point.value}><strong>{point.value}</strong><span>{point.label}</span></div>)}
      </section>
    </>
  );
}

