'use client';

import {useRouter} from 'next/navigation';
import {ReportForm} from '@/components/piling/report-form';
import '@/components/piling/operator-mobile/operator-concept.css';

export default function OperatorV3ReportPage() {
  const router = useRouter();
  return <div className="operator-report-concept"><ReportForm onExit={() => router.push('/operator/v3')} /></div>;
}
