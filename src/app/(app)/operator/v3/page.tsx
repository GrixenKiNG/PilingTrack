import {OperatorWorkplaceEntry} from '@/components/piling/operator-v3/operator-workplace-entry';
import {OperatorWorkplaceProvider} from '@/components/piling/operator-v3/state/operator-workplace-provider';

export default function OperatorV3Page() {
  return <OperatorWorkplaceProvider><OperatorWorkplaceEntry /></OperatorWorkplaceProvider>;
}
