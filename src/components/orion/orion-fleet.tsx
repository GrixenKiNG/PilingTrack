'use client';

import { useState } from 'react';
import { ArrowDownRight, HardHat } from 'lucide-react';
import { orionEquipment } from './orion-content';
import { OrionEquipmentProfilePanel } from './orion-equipment-profile';
import { orionEquipmentProfiles } from './orion-equipment-profiles';
import styles from './orion-site.module.css';

export function OrionFleet() {
  const [activePhotos, setActivePhotos] = useState<Record<string, number>>({});
  const [expandedProfiles, setExpandedProfiles] = useState<Record<string, boolean>>({});

  return (
    <section className={styles.fleet} id="fleet">
      <div className={styles.sectionHeading}>
        <p className={styles.kicker}>Парк техники / 8 единиц</p>
        <h2>Своя техника.<br /><em>Свой контроль.</em></h2>
        <p>Восемь подтверждённых единиц парка. Внешние фотографии показывают модель техники и сопровождаются ссылкой на источник.</p>
      </div>

      <div className={styles.fleetList}>
        {orionEquipment.map((equipment, index) => {
          const activeIndex = activePhotos[equipment.name] ?? 0;
          const activePhoto = equipment.photos[activeIndex] ?? equipment.photos[0];
          const profile = orionEquipmentProfiles[equipment.profileKey];
          const panelId = `orion-profile-${index}-${equipment.profileKey}`;
          const profileExpanded = expandedProfiles[equipment.name] ?? false;

          return (
            <article className={styles.machine} key={equipment.name}>
              <div className={styles.machineImage}>
                <img src={activePhoto.src} alt={activePhoto.alt} loading={index > 0 ? 'lazy' : undefined} />
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span className={styles.photoCount}>{equipment.photos.length}/{equipment.photoSlots} проверено фото</span>
              </div>
              <div className={styles.machineContent}>
                <div className={styles.machineBody}>
                  <p>{equipment.category}</p>
                  <h3>{equipment.name}</h3>
                  <span>{equipment.summary}</span>
                  <a href={activePhoto.sourceUrl} target="_blank" rel="noreferrer">{activePhoto.credit} · источник <ArrowDownRight size={14} /></a>
                  <OrionEquipmentProfilePanel
                    equipmentName={equipment.name}
                    expanded={profileExpanded}
                    onToggle={() => setExpandedProfiles((current) => ({
                      ...current,
                      [equipment.name]: !profileExpanded,
                    }))}
                    panelId={panelId}
                    profile={profile}
                  />
                </div>
                <div className={styles.machineThumbs} aria-label={`Фотографии ${equipment.name}`}>
                  {Array.from({ length: equipment.photoSlots }, (_, photoIndex) => {
                    const photo = equipment.photos[photoIndex];

                    return photo ? (
                      <button
                        aria-label={`Показать фото ${photoIndex + 1} — ${equipment.name}`}
                        aria-pressed={activeIndex === photoIndex}
                        className={activeIndex === photoIndex ? styles.activeThumb : undefined}
                        key={photo.src}
                        onClick={() => setActivePhotos((current) => ({ ...current, [equipment.name]: photoIndex }))}
                        type="button"
                      >
                        <img src={photo.src} alt="" loading="lazy" />
                      </button>
                    ) : (
                      <span className={styles.pendingThumb} key={`pending-${photoIndex}`}><HardHat size={13} /><i>ожидает</i></span>
                    );
                  })}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

