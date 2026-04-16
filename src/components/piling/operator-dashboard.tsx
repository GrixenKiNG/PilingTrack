'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  HardHat,
  Plus,
  MapPin,
  FileText,
  ChevronRight,
  CalendarDays,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  const [formattedDate, setFormattedDate] = useState('');

  useEffect(() => {
    const now = new Date();
    setToday(now.toISOString().split('T')[0]);
    const raw = now.toLocaleDateString('ru-RU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    setFormattedDate(raw.charAt(0).toUpperCase() + raw.slice(1));
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
        setSites(sitesData.sites || []);

        if (!selectedSiteId && sitesData.sites?.[0]?.id) {
          setSelectedSite(sitesData.sites[0].id);
        }
      }

      if (reportsRes.ok) {
        const reportsData = await reportsRes.json();
        const reportItems = reportsData.reports || [];
        setReports(reportItems);
        setTodayReport(reportItems.find((report: ReportListItemDTO) => report.date === today) || null);
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

  const totalPiles = reports.reduce((sum, report) => sum + report.totalPiles, 0);
  const totalDrilling = reports.reduce((sum, report) => sum + report.totalDrilling, 0);

  const handleCreateReport = () => {
    router.push('/report');
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Добро пожаловать, {user?.name?.split(' ')[0] || 'Оператор'}
        </h1>
        <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
          <CalendarDays className="w-4 h-4" />
          <span>{formattedDate}</span>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card
          className="border-l-4 cursor-pointer card-hover"
          style={{ borderLeftColor: todayReport ? '#22c55e' : '#f97316' }}
          onClick={handleCreateReport}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  backgroundColor: todayReport ? 'rgba(34, 197, 94, 0.1)' : 'rgba(249, 115, 22, 0.1)',
                }}
              >
                <FileText className="w-5 h-5" style={{ color: todayReport ? '#22c55e' : '#f97316' }} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Отчёт за сегодня</p>
                <p className="text-xs text-slate-500">
                  {todayReport
                    ? `${todayReport.totalPiles} свай · ${todayReport.totalDrilling} м бурения`
                    : 'Нажмите, чтобы создать отчёт'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={todayReport ? 'default' : 'secondary'}
                className={
                  todayReport
                    ? 'bg-green-100 text-green-700 border-green-200'
                    : 'bg-orange-100 text-orange-700 border-orange-200'
                }
              >
                {todayReport ? 'Есть' : 'Создать'}
              </Badge>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-orange-500" />
            Объект
          </label>

          {sites.length > 0 ? (
            <Select value={selectedSiteId || ''} onValueChange={(value) => setSelectedSite(value)}>
              <SelectTrigger className="w-full h-11">
                <SelectValue placeholder="Выберите объект" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="w-full h-11 rounded-md border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center px-3">
              <p className="text-sm text-slate-400">Нет назначенных объектов</p>
            </div>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 gap-3"
      >
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                <HardHat className="w-4 h-4 text-orange-600" />
              </div>
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">{totalPiles}</p>
            <p className="text-xs text-slate-500">Свай забито</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">{totalDrilling}</p>
            <p className="text-xs text-slate-500">Метров бурения</p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Button
          onClick={handleCreateReport}
          className="w-full h-14 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-base"
        >
          {todayReport ? (
            <>
              <FileText className="w-5 h-5 mr-2" />
              Редактировать отчёт
            </>
          ) : (
            <>
              <Plus className="w-5 h-5 mr-2" />
              Создать отчёт за смену
            </>
          )}
        </Button>
      </motion.div>

      {reports.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Последние отчёты</h2>
            <button
              onClick={() => router.push('/history')}
              className="text-xs text-orange-500 font-medium flex items-center gap-1 hover:text-orange-600"
            >
              Все
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-2">
            {reports.slice(0, 3).map((report) => (
              <Card key={report.id} className="card-hover">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{report.siteName}</p>
                    <p className="text-xs text-slate-500">{new Date(report.date).toLocaleDateString('ru-RU')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-semibold text-slate-900">{report.totalPiles} св.</p>
                    <Badge
                      variant="secondary"
                      className={
                        report.status === 'submitted'
                          ? 'bg-green-100 text-green-700 border-green-200 text-[10px]'
                          : 'bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px]'
                      }
                    >
                      {report.status === 'submitted' ? 'Отправлен' : 'Черновик'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>
      )}

      {!loading && sites.length === 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="text-center py-12">
            <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Нет назначенных объектов</p>
            <p className="text-xs text-slate-400 mt-1">Обратитесь к администратору для назначения на объект</p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
