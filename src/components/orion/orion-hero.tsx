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
          <p className={styles.kicker}>{'\u0421\u0432\u0430\u0439\u043d\u044b\u0435 \u0440\u0430\u0431\u043e\u0442\u044b \u00b7 \u0430\u0440\u0435\u043d\u0434\u0430 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043e\u043a \u0441 \u044d\u043a\u0438\u043f\u0430\u0436\u0435\u043c'}</p>
          <h1>{'\u0421\u0432\u0430\u0439\u043d\u044b\u0435 \u0440\u0430\u0431\u043e\u0442\u044b,'}<br /><em>{'\u043d\u0430 \u043a\u043e\u0442\u043e\u0440\u044b\u0445'}</em>{' \u0434\u0435\u0440\u0436\u0430\u0442\u0441\u044f \u0431\u043e\u043b\u044c\u0448\u0438\u0435 \u043f\u0440\u043e\u0435\u043a\u0442\u044b.'}</h1>
          <p className={styles.lead}>{'\u041e\u0420\u0418\u041e\u041d \u043f\u043e\u0434\u0431\u0438\u0440\u0430\u0435\u0442 \u0442\u0435\u0445\u043d\u043e\u043b\u043e\u0433\u0438\u044e, \u0442\u0435\u0445\u043d\u0438\u043a\u0443 \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c \u0440\u0430\u0431\u043e\u0442 \u043f\u043e\u0434 \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435, \u041f\u041f\u0420 \u0438 \u0433\u0440\u0430\u0444\u0438\u043a \u043e\u0431\u044a\u0435\u043a\u0442\u0430.'}</p>
          <div className={styles.actions}>
            <a className={styles.primaryButton} href="#contact">{'\u041e\u0431\u0441\u0443\u0434\u0438\u0442\u044c \u043e\u0431\u044a\u0435\u043a\u0442'} <ArrowDownRight /></a>
            <a className={styles.secondaryButton} href="#tender">{'\u041f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0442\u0435\u043d\u0434\u0435\u0440\u043d\u044b\u0439 \u043f\u0430\u043a\u0435\u0442'} <ChevronRight /></a>
          </div>
        </div>
        <div className={styles.heroReference}>
          <span>{'Bauer RTG RM20 \u00b7 \u0440\u0435\u0444\u0435\u0440\u0435\u043d\u0441 \u043c\u043e\u0434\u0435\u043b\u0438'}</span>
          <a href="https://geomek.se/en/foundations/machines/bauer-rtg/" target="_blank" rel="noreferrer">{'\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a \u2197'}</a>
        </div>
        <a className={styles.scrollCue} href="#proof"><span>{'\u041f\u0440\u043e\u043a\u0440\u0443\u0442\u0438\u0442\u044c'}</span><i /></a>
      </section>

      <section className={styles.proof} id="proof" aria-label={'\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d\u043d\u044b\u0435 \u0441\u0432\u0435\u0434\u0435\u043d\u0438\u044f'}>
        {orionProofPoints.map((point) => <div key={point.value}><strong>{point.value}</strong><span>{point.label}</span></div>)}
      </section>
    </>
  );
}

