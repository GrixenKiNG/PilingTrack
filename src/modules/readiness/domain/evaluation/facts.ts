import type {ReadinessFacts} from '../readiness-score';
import type {WorkPermitCloseReason} from '../permits/types';

export type AuthoritativeReadinessFacts = Readonly<ReadinessFacts & {
  /** Старые неизменяемые снимки не содержат причину закрытия. */
  permitCloseReason?: WorkPermitCloseReason | null;
}>;
