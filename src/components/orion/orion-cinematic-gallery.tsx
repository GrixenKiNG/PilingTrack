'use client';

import Image from 'next/image';
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { orionEquipment } from './orion-content';
import styles from './orion-cinematic-gallery.module.css';

const galleryIndexes = [7, 1, 0, 6, 3] as const;

export function OrionCinematicGallery() {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const entries = galleryIndexes.map((index) => orionEquipment[index]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const update = () => {
      frameRef.current = null;
      const rect = section.getBoundingClientRect();
      const scrollRange = Math.max(section.offsetHeight - window.innerHeight, 1);
      const nextProgress = Math.min(1, Math.max(0, -rect.top / scrollRange));
      const nextIndex = Math.min(entries.length - 1, Math.floor(nextProgress * entries.length));

      setProgress(nextProgress);
      setActiveIndex((current) => current === nextIndex ? current : nextIndex);
    };

    const requestUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(update);
    };

    update();
    if (!reduceMotion) {
      window.addEventListener('scroll', requestUpdate, { passive: true });
      window.addEventListener('resize', requestUpdate);
    }

    return () => {
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [entries.length]);

  const active = entries[activeIndex];
  const progressStyle = { '--gallery-progress': progress } as CSSProperties;

  return (
    <section
      className={styles.gallery}
      id="gallery"
      ref={sectionRef}
      aria-label="Кинематографическая галерея моделей техники"
    >
      <div className={styles.sticky}>
        <div className={styles.marquee} aria-hidden="true">
          <span>ТЕХНИКА ДЛЯ БОЛЬШИХ ОСНОВАНИЙ</span>
          <i>ПРОЕКТ · ППР · ПРОИЗВОДСТВО</i>
          <span>ТЕХНИКА ДЛЯ БОЛЬШИХ ОСНОВАНИЙ</span>
          <i>ПРОЕКТ · ППР · ПРОИЗВОДСТВО</i>
        </div>

        <div className={styles.layers}>
          {entries.map((equipment, index) => {
            const photo = equipment.photos[Math.min(2, equipment.photos.length - 1)];
            return (
              <figure
                className={index === activeIndex ? styles.activeLayer : styles.layer}
                aria-hidden={index !== activeIndex}
                key={equipment.name}
              >
                <Image
                  src={photo.src}
                  alt={index === activeIndex ? photo.alt : ''}
                  fill
                  sizes="100vw"
                  loading={index === 0 ? 'eager' : 'lazy'}
                />
              </figure>
            );
          })}
        </div>

        <div className={styles.caption}>
          <p>Фото модели · источник указан в карточке парка</p>
          <h2 aria-live="polite">{active.name}</h2>
          <div>
            <span>{active.category}</span>
            <strong>{String(activeIndex + 1).padStart(2, '0')} / {String(entries.length).padStart(2, '0')}</strong>
          </div>
        </div>

        <div className={styles.progress} style={progressStyle} aria-hidden="true"><i /></div>
      </div>
    </section>
  );
}
