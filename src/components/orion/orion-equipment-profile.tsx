import { ArrowDownRight, ChevronDown, Download } from 'lucide-react';
import type { OrionEquipmentProfile } from './orion-equipment-profiles';
import styles from './orion-site.module.css';

type OrionEquipmentProfilePanelProps = {
  profile: OrionEquipmentProfile;
  panelId: string;
  expanded: boolean;
  onToggle: () => void;
};

export function OrionEquipmentProfilePanel({
  profile,
  panelId,
  expanded,
  onToggle,
}: OrionEquipmentProfilePanelProps) {
  const highlightedSpecifications = [
    ...profile.specifications.filter(({ featured }) => featured),
    ...profile.specifications.filter(({ featured }) => !featured),
  ].slice(0, 3);

  return (
    <div>
      <dl className={styles.machineHighlights} aria-label={`Ключевые характеристики ${profile.model}`}>
        {highlightedSpecifications.map((specification) => (
          <div key={specification.label}>
            <dt>{specification.label}</dt>
            <dd>{specification.value}</dd>
          </div>
        ))}
      </dl>

      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className={styles.profileToggle}
        onClick={onToggle}
        type="button"
      >
        <span>Все характеристики {profile.model}</span>
        <ChevronDown aria-hidden="true" size={18} />
      </button>

      <section
        aria-label={`Технические характеристики ${profile.model}`}
        className={styles.profilePanel}
        hidden={!expanded}
        id={panelId}
      >
        <p>{profile.description}</p>

        <dl className={styles.specGrid}>
          {profile.specifications.map((specification) => (
            <div key={specification.label}>
              <dt>{specification.label}</dt>
              <dd>{specification.value}</dd>
            </div>
          ))}
        </dl>

        <h4>Особенности модели</h4>
        <ul className={styles.featureList}>
          {profile.features.map((feature) => <li key={feature}>{feature}</li>)}
        </ul>

        <p className={styles.profileNotice}>
          {profile.disclaimer} Подготовлено {profile.preparedAt}.
        </p>

        <div className={styles.profileActions}>
          <a download href={profile.pdfPath}>
            Скачать PDF на русском <Download aria-hidden="true" size={16} />
          </a>
          <a href={profile.source.url} rel="noreferrer" target="_blank">
            Источник характеристик <ArrowDownRight aria-hidden="true" size={16} />
          </a>
        </div>
      </section>
    </div>
  );
}
