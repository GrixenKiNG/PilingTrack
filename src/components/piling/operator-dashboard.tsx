'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChevronRight, MapPin, Plus, FileText, History } from 'lucide-react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { getTodayInTimezone } from '@/lib/timezone';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SiteFlatDTO, ReportListItemDTO } from '@/lib/types';

export function OperatorDashboard() {
  const user = usePilingStore((s) => s.currentUser);
  const router = useRouter();
  const selectedSiteId = usePilingStore((s) => s.selectedSiteId);
  const setSelectedSite = usePilingStore((s) => s.setSelectedSite);

  const [sites, setSites] = useState<SiteFlatDTO[]>([]);
  const [reports, setReports] = useState<ReportListItemDTO[]>([]);
  const [todayReport, setTodayReport] = useState<ReportListItemDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState('');

  useEffect(() => {
    setToday(getTodayInTimezone());
  }, []);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [sitesRes, reportsRes] = await Promise.all([
        authFetch(`/api/sites?userId=${user.id}`),
        authFetch(`/api/reports/my?userId=${user.id}`),
      ]);

      if (sitesRes.ok) {
        const sitesData = await sitesRes.json();
        const accessibleSites = sitesData.data || sitesData.sites || [];
        setSites(accessibleSites);
        if (accessibleSites.length === 0) {
          setSelectedSite(null);
        } else if (!selectedSiteId || !accessibleSites.some((site: SiteFlatDTO) => site.id === selectedSiteId)) {
          setSelectedSite(accessibleSites[0].id);
        }
      }

      if (reportsRes.ok) {
        const reportsData = await reportsRes.json();
        const items = reportsData.data || reportsData.reports || [];
        setReports(items);
        setTodayReport(items.find((r: ReportListItemDTO) => r.date === today) || null);
      }
    } catch {
      toast.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, setSelectedSite, today, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentSite = sites.find((s) => s.id === selectedSiteId);
  const active = !!todayReport;
  const noSite = sites.length === 0;
  const siteNotSelected = !noSite && !currentSite;
  const ctaDisabled = noSite || siteNotSelected;

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const displayName = user?.name?.trim() || 'Оператор';

  return (
    <div className="p-4 pb-24 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">Здравствуйте,</p>
          <h1 className="text-lg font-semibold text-slate-900">{displayName}</h1>
        </div>
        {reports.length > 0 && (
          <button
            onClick={() => router.push('/history')}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            <History className="w-3.5 h-3.5" />
            История
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </header>

      {/* HERO CTA — dominant action */}
      <motion.button
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => router.push('/report')}
        disabled={ctaDisabled}
        aria-label={
          noSite ? 'Нет назначенных объектов' :
          siteNotSelected ? 'Выберите объект' :
          active ? 'Редактировать отчёт за сегодня' : 'Начать смену'
        }
        className={`relative w-full min-h-[320px] rounded-2xl p-6 text-left transition-all active:scale-[0.99] disabled:cursor-not-allowed overflow-hidden ${
          ctaDisabled
            ? 'bg-gradient-to-br from-slate-400 to-slate-500 text-white shadow-md'
            : active
            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30'
            : 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30'
        }`}
      >
        <div className="absolute top-4 right-4 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider bg-white/20 backdrop-blur px-2.5 py-1 rounded-full">
          <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-200 animate-pulse' : 'bg-white/80'}`} />
          {noSite ? 'Нет объекта' : siteNotSelected ? 'Выберите объект' : active ? 'Смена идёт' : 'Начать смену'}
        </div>

        <div className="flex flex-col justify-between h-full min-h-[272px]">
          <div>
            <p className="text-sm font-medium text-white/80">Отчёт за сегодня</p>
            <div className="mt-2 flex items-baseline gap-2">
              {todayReport ? (
                <>
                  <span className="text-7xl font-bold font-mono tabular-nums leading-none">
                    {todayReport.totalPiles}
                  </span>
                  <span className="text-lg text-white/80">свай</span>
                </>
              ) : (
                <span className="text-4xl font-bold">Новая смена</span>
              )}
            </div>
            {todayReport && (
              <p className="mt-2 text-sm text-white/80 font-mono">
                + {todayReport.totalDrilling} м бурения
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 text-base font-semibold mt-6">
            {active ? <FileText className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            <span>
              {noSite ? 'Нет назначенных объектов' :
               siteNotSelected ? 'Выберите объект ниже' :
               active ? 'Редактировать' : 'Создать отчёт'}
            </span>
            {!ctaDisabled && <ChevronRight className="w-5 h-5 ml-auto" />}
          </div>
        </div>
      </motion.button>

      {/* Secondary: site selector */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          Объект
        </label>
        {sites.length > 0 ? (
          <Select value={selectedSiteId || ''} onValueChange={setSelectedSite}>
            <SelectTrigger className="w-full h-12">
              <SelectValue placeholder="Выберите объект" />
            </SelectTrigger>
            <SelectContent>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="h-12 rounded-md border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-sm text-slate-400">
            Нет назначенных объектов
          </div>
        )}
      </div>

      {reports.length > 0 && (
        <section className="border-t border-slate-200 pt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Последние отчёты
          </h2>
          <ul className="divide-y divide-slate-100">
            {reports.slice(0, 3).map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => router.push(`/history?reportId=${r.id}`)}
                  className="w-full flex items-center justify-between py-3 text-left hover:bg-slate-50 rounded-md px-2 -mx-2 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{r.siteName}</p>
                    <p className="text-xs text-slate-500 font-mono">
                      {new Date(r.date).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                    <span>{r.totalPiles} св.</span>
                    <span className="text-slate-300">·</span>
                    <span>{r.totalDrilling} м</span>
                    <ChevronRight className="w-4 h-4 text-slate-400 ml-1" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
