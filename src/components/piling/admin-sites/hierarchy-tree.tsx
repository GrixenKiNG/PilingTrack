'use client';

import { motion } from 'framer-motion';
import {
  Plus,
  Trash2,
  FolderTree,
} from 'lucide-react';
import type { SiteFullData } from './types';

interface HierarchyTreeProps {
  siteId: string;
  tree: SiteFullData;
  onAdd: (type: 'field' | 'cluster' | 'picket', siteId: string, parentId: string) => void;
  onDelete: (siteId: string, type: string, itemId: string) => void;
}

export function HierarchyTree({ siteId, tree, onAdd, onDelete }: HierarchyTreeProps) {
  return (
    <div className="pl-4 border-l-2 border-orange-200 space-y-2">
      {/* Fields */}
      {tree.fields.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">
          Нет свайных полей. Нажмите + чтобы добавить.
        </p>
      ) : (
        tree.fields.map((field) => (
          <div key={field.id}>
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <FolderTree className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-sm font-medium text-slate-800">
                  {field.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onAdd('cluster', siteId, field.id)}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-orange-50 text-orange-400 hover:text-orange-600"
                  title="Добавить куст"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onDelete(siteId, 'field', field.id)}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-slate-300 hover:text-red-500"
                  title="Удалить поле"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            {/* Clusters */}
            <div className="pl-4 border-l border-slate-200 space-y-1">
              {field.clusters.length === 0 ? (
                <p className="text-[10px] text-slate-400 py-0.5">Нет кустов</p>
              ) : (
                field.clusters.map((cluster) => (
                  <div key={cluster.id}>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-xs text-slate-700">{cluster.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onAdd('picket', siteId, cluster.id)}
                          className="w-5 h-5 rounded flex items-center justify-center hover:bg-orange-50 text-orange-400 hover:text-orange-600"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                        <button
                          onClick={() => onDelete(siteId, 'cluster', cluster.id)}
                          className="w-5 h-5 rounded flex items-center justify-center hover:bg-red-50 text-slate-300 hover:text-red-500"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    {/* Pickets */}
                    <div className="pl-3 space-y-0.5">
                      {cluster.pickets.length === 0 ? (
                        <p className="text-[10px] text-slate-400 py-0.5">Нет пикетов</p>
                      ) : (
                        cluster.pickets.map((picket) => (
                          <div
                            key={picket.id}
                            className="flex items-center justify-between py-0.5"
                          >
                            <span className="text-[11px] text-slate-500">
                              {'\ud83d\udccd'} {picket.name}
                            </span>
                            <button
                              onClick={() => onDelete(siteId, 'picket', picket.id)}
                              className="w-5 h-5 rounded flex items-center justify-center hover:bg-red-50 text-slate-300 hover:text-red-500"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))
      )}
      <button
        onClick={() => onAdd('field', siteId, siteId)}
        className="flex items-center gap-1.5 text-xs text-orange-500 hover:text-orange-600 font-medium py-1"
      >
        <Plus className="w-3 h-3" />
        Добавить свайное поле
      </button>
    </div>
  );
}

// Plans summary sub-component
interface PlansSummaryProps {
  tree: SiteFullData;
}

export function PlansSummary({ tree }: PlansSummaryProps) {
  if (
    (!tree.pilePlans || tree.pilePlans.length === 0) &&
    (!tree.drillingPlans || tree.drillingPlans.length === 0)
  ) {
    return null;
  }

  return (
    <div className="mt-3 mb-2 space-y-2">
      {/* Pile Plans */}
      {tree.pilePlans && tree.pilePlans.length > 0 && (
        <div className="bg-orange-50 border border-orange-100 rounded-lg p-3">
          <p className="text-xs font-semibold text-orange-700 mb-1.5 flex items-center gap-1">
            План свай
          </p>
          <div className="space-y-1">
            {tree.pilePlans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">{plan.pileGrade.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 font-mono">
                    {plan.count} шт × {plan.metersPerUnit} м
                  </span>
                  <span className="font-mono font-semibold text-orange-700">
                    {(plan.count * plan.metersPerUnit).toFixed(1)} м
                  </span>
                </div>
              </div>
            ))}
            <div className="border-t border-orange-200 pt-1 flex items-center justify-between text-xs font-semibold">
              <span className="text-orange-800">Итого</span>
              <div className="flex items-center gap-3 text-orange-800">
                <span className="font-mono">
                  {tree.pilePlans.reduce((s, p) => s + p.count, 0)} свай
                </span>
                <span className="font-mono">
                  {tree.pilePlans.reduce((s, p) => s + p.count * p.metersPerUnit, 0).toFixed(1)} м
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drilling Plans */}
      {tree.drillingPlans && tree.drillingPlans.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1">
            План бурения
          </p>
          <div className="space-y-1">
            {tree.drillingPlans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">{'\u2300'}{plan.diameter} мм</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 font-mono">
                    {plan.count} шт × {plan.metersPerUnit} м
                  </span>
                  <span className="font-mono font-semibold text-blue-700">
                    {(plan.count * plan.metersPerUnit).toFixed(1)} м
                  </span>
                </div>
              </div>
            ))}
            <div className="border-t border-blue-200 pt-1 flex items-center justify-between text-xs font-semibold">
              <span className="text-blue-800">Итого бурение</span>
              <span className="font-mono text-blue-800">
                {tree.drillingPlans.reduce((s, p) => s + p.count * p.metersPerUnit, 0).toFixed(1)} м
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Expanded tree content (plans + hierarchy) with animation wrapper
interface ExpandedTreeContentProps {
  siteId: string;
  tree: SiteFullData;
  onAdd: (type: 'field' | 'cluster' | 'picket', siteId: string, parentId: string) => void;
  onDelete: (siteId: string, type: string, itemId: string) => void;
}

export function ExpandedTreeContent({ siteId, tree, onAdd, onDelete }: ExpandedTreeContentProps) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <PlansSummary tree={tree} />
      <HierarchyTree siteId={siteId} tree={tree} onAdd={onAdd} onDelete={onDelete} />
    </motion.div>
  );
}
