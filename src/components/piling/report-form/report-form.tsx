'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useReportForm } from './use-report-form';
import { ShiftInfo } from './shift-info';
import { CascadingSelect } from './cascading-select';
import { PileSection } from './pile-section';
import { DrillingSection } from './drilling-section';
import { DowntimeSection } from './downtime-section';
import { SubmitBar } from './submit-bar';
import { ReportSentScreen } from './report-sent-screen';
import { PhotoSection } from './photo-section';
import { filterPileGradesBySitePlan } from './filter-pile-grades';

// Temp state for form inputs (kept local to avoid re-renders on every keystroke)
function useTempState() {
  const [tempPileGrade, setTempPileGrade] = useState('');
  const [tempPileCount, setTempPileCount] = useState('');
  const [tempDrillType, setTempDrillType] = useState('');
  const [tempDrillCount, setTempDrillCount] = useState('');
  const [tempDrillMetersPerUnit, setTempDrillMetersPerUnit] = useState('');
  const [tempDowntimeReason, setTempDowntimeReason] = useState('');
  const [tempDowntimeDuration, setTempDowntimeDuration] = useState('');
  const [tempDowntimeComment, setTempDowntimeComment] = useState('');

  const addPile = (onAdd: (g: string, c: number) => void) => {
    if (!tempPileGrade || !tempPileCount || Number(tempPileCount) <= 0) return;
    onAdd(tempPileGrade, Number(tempPileCount));
    setTempPileGrade(''); setTempPileCount('');
  };

  const addDrilling = (onAdd: (t: string, c: number, m: number) => void) => {
    if (!tempDrillType || !tempDrillCount || !tempDrillMetersPerUnit || Number(tempDrillCount) <= 0 || Number(tempDrillMetersPerUnit) <= 0) return;
    onAdd(tempDrillType, Number(tempDrillCount), Number(tempDrillMetersPerUnit));
    setTempDrillType(''); setTempDrillCount(''); setTempDrillMetersPerUnit('');
  };

  const addDowntime = (onAdd: (r: string, d: number, c: string) => void) => {
    if (!tempDowntimeReason || !tempDowntimeDuration || Number(tempDowntimeDuration) <= 0) return;
    onAdd(tempDowntimeReason, Number(tempDowntimeDuration), tempDowntimeComment);
    setTempDowntimeReason(''); setTempDowntimeDuration(''); setTempDowntimeComment('');
  };

  return {
    tempPileGrade, setTempPileGrade, tempPileCount, setTempPileCount,
    tempDrillType, setTempDrillType, tempDrillCount, setTempDrillCount,
    tempDrillMetersPerUnit, setTempDrillMetersPerUnit,
    tempDowntimeReason, setTempDowntimeReason,
    tempDowntimeDuration, setTempDowntimeDuration,
    tempDowntimeComment, setTempDowntimeComment,
    addPile, addDrilling, addDowntime,
  };
}

export function ReportForm() {
  const {
    reportId,
    date, setDate, shiftStart, setShiftStart, shiftEnd, setShiftEnd,
    sites, siteTree, selectedSiteId, setSelectedSiteId,
    pileGrades, drillingTypes, downtimeReasons, equipment,
    selectedEquipmentId, setSelectedEquipmentId,
    selectedFieldId, setSelectedFieldId, selectedClusterId, setSelectedClusterId,
    selectedPicketId, setSelectedPicketId,
    piles, drillings, downtimes,
    showDowntime, setShowDowntime, quickMode, setQuickMode,
    loading, loadError, reloadData, submitting, submittedAt,
    addPile, addDrilling, addDowntime, removePile, removeDrilling, removeDowntime,
    handleSubmit, getPileMetersPerUnit, getPicketPath,
    getPileGradeName, getDrillTypeName, getDowntimeReasonName,
    loadSiteTree,
  } = useReportForm();

  const router = useRouter();
  const temp = useTempState();

  // Computed
  const totalPiles = piles.reduce((s, p) => s + p.count, 0);
  const totalPileMeters = piles.reduce((s, p) => s + p.count * getPileMetersPerUnit(p.pileGradeId), 0);
  const totalMeters = drillings.reduce((s, d) => s + d.meters, 0);
  const totalDrillingCount = drillings.reduce((s, d) => s + d.count, 0);
  const totalDowntime = downtimes.reduce((s, d) => s + d.duration, 0);
  const hasEntries = piles.length > 0 || drillings.length > 0 || downtimes.length > 0;

  const handleSiteChange = (val: string) => {
    setSelectedSiteId(val);
    // Reset the picket hierarchy — a field/cluster/picket from the previous site
    // must not carry into a report for the new site.
    setSelectedFieldId('');
    setSelectedClusterId('');
    setSelectedPicketId('');
    loadSiteTree(val);
  };

  const handleFieldChange = (val: string) => { setSelectedFieldId(val); setSelectedClusterId(''); setSelectedPicketId(''); };
  const handleClusterChange = (val: string) => { setSelectedClusterId(val); setSelectedPicketId(''); };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-10 w-full" /><Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <p className="text-base font-semibold text-slate-900 mb-2">Не удалось загрузить данные формы</p>
        <p className="text-sm text-slate-500 mb-6">Проверьте интернет и попробуйте ещё раз.</p>
        <button onClick={reloadData}
          className="h-11 px-6 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold">
          Повторить
        </button>
      </div>
    );
  }

  if (submittedAt) {
    return (
      <ReportSentScreen
        siteName={sites.find((s) => s.id === selectedSiteId)?.name || ''}
        date={date} time={submittedAt}
        totalPiles={totalPiles} totalPileMeters={totalPileMeters}
        totalDrillingCount={totalDrillingCount} totalMeters={totalMeters}
        totalDowntime={totalDowntime} hasDowntime={downtimes.length > 0}
        onDone={() => router.push('/operator')}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 pt-safe flex items-center gap-3">
        <button onClick={() => router.push('/operator')}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-slate-900 truncate">Отчёт за смену</h1>
          <p className="text-xs text-slate-500 truncate">{sites.find((s) => s.id === selectedSiteId)?.name || 'Выберите объект'}</p>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto pb-24">
        <div className="p-4 space-y-4">
          <ShiftInfo date={date} onDateChange={setDate} shiftStart={shiftStart} onShiftStartChange={setShiftStart}
            shiftEnd={shiftEnd} onShiftEndChange={setShiftEnd}
            sites={sites} selectedSiteId={selectedSiteId} onSiteChange={handleSiteChange}
            equipment={equipment} selectedEquipmentId={selectedEquipmentId} onEquipmentChange={setSelectedEquipmentId} />

          {selectedSiteId && siteTree && siteTree.fields.length > 0 && (
            <CascadingSelect siteTree={siteTree} selectedFieldId={selectedFieldId} selectedClusterId={selectedClusterId}
              selectedPicketId={selectedPicketId} onFieldChange={handleFieldChange} onClusterChange={handleClusterChange}
              onPicketChange={setSelectedPicketId} />
          )}

          <PileSection piles={piles} pileGrades={filterPileGradesBySitePlan(pileGrades, siteTree?.pilePlans)} quickMode={quickMode}
            tempGrade={temp.tempPileGrade} tempCount={temp.tempPileCount}
            onTempGradeChange={temp.setTempPileGrade} onTempCountChange={temp.setTempPileCount}
            onAdd={() => temp.addPile(addPile)} onRemove={removePile} onToggleMode={() => setQuickMode(!quickMode)}
            getPileGradeName={getPileGradeName} getPileMetersPerUnit={getPileMetersPerUnit}
            getPicketPath={getPicketPath} totalPiles={totalPiles} totalMeters={totalPileMeters} />

          <DrillingSection drillings={drillings} drillingTypes={drillingTypes}
            tempType={temp.tempDrillType} tempCount={temp.tempDrillCount} tempMetersPerUnit={temp.tempDrillMetersPerUnit}
            onTempTypeChange={temp.setTempDrillType} onTempCountChange={temp.setTempDrillCount}
            onTempMetersPerUnitChange={temp.setTempDrillMetersPerUnit} onAdd={() => temp.addDrilling(addDrilling)}
            onRemove={removeDrilling} getDrillTypeName={getDrillTypeName} getPicketPath={getPicketPath}
            totalMeters={totalMeters} />

          <DowntimeSection downtimes={downtimes} downtimeReasons={downtimeReasons} show={showDowntime} onToggle={() => setShowDowntime(!showDowntime)}
            tempReason={temp.tempDowntimeReason} tempDuration={temp.tempDowntimeDuration} tempComment={temp.tempDowntimeComment}
            onTempReasonChange={temp.setTempDowntimeReason} onTempDurationChange={temp.setTempDowntimeDuration}
            onTempCommentChange={temp.setTempDowntimeComment} onAdd={() => temp.addDowntime(addDowntime)}
            onRemove={removeDowntime} getDowntimeReasonName={getDowntimeReasonName} totalDowntime={totalDowntime} />

          <PhotoSection reportId={reportId} canEdit />

          <SubmitBar totalPiles={totalPiles} totalPileMeters={totalPileMeters}
            totalDrillingCount={totalDrillingCount} totalMeters={totalMeters}
            totalDowntime={totalDowntime} hasDowntime={downtimes.length > 0}
            selectedSiteId={selectedSiteId} hasEntries={hasEntries} submitting={submitting} onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}
