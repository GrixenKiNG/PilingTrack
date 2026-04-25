/**
 * Conflict Resolution Panel — UI Component
 *
 * Displays unresolved conflicts from sync and allows manual resolution.
 * Shows field-level diff with color coding:
 * - Red: critical fields (server wins by default)
 * - Yellow: non-critical fields (client wins by default)
 *
 * Usage:
 *   <ConflictPanel conflicts={conflicts} onResolve={handleResolve} />
 */

'use client';

import { useState } from 'react';
import { useSyncConflict, type ConflictFieldDiff } from '@/mobile/ui/use-sync-conflict';
import type { Conflict } from '@/core/shared/types/sync';

interface ConflictPanelProps {
  conflicts: Conflict[];
  onResolved?: (changes: any[]) => void;
}

export function ConflictPanel({ conflicts, onResolved }: ConflictPanelProps) {
  const {
    addConflicts,
    getFieldDiff,
    resolveConflict,
    resolveAll,
    buildResolvedChanges,
    conflictCount,
    hasUnresolved,
  } = useSyncConflict();

  const [selectedConflict, setSelectedConflict] = useState<Conflict | null>(null);

  // Initialize conflicts from props
  useState(() => {
    if (conflicts.length > 0) {
      addConflicts(conflicts);
    }
  });

  if (!hasUnresolved) {
    return null;
  }

  const handleResolveSingle = (
    conflict: Conflict,
    strategy: 'accept_client' | 'accept_server' | 'custom'
  ) => {
    resolveConflict(conflict, strategy);
    setSelectedConflict(null);
  };

  const handleResolveAll = (strategy: 'accept_client' | 'accept_server' | 'server_wins_critical') => {
    const resolved = resolveAll(strategy);
    const changes = buildResolvedChanges(resolved);
    onResolved?.(changes);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-h-[80vh] w-96 overflow-auto rounded-lg border border-red-200 bg-white shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-3">
        <div>
          <h3 className="font-semibold text-red-800">
            Sync Conflicts ({conflictCount})
          </h3>
          <p className="text-xs text-red-600">
            {conflictCount > 1
              ? 'Multiple devices edited the same data'
              : 'Another device modified this data'}
          </p>
        </div>
        <button
          onClick={() => handleResolveAll('server_wins_critical')}
          className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          Auto-resolve all
        </button>
      </div>

      {/* Conflict List */}
      <div className="divide-y divide-gray-100">
        {conflicts.map((conflict, index) => (
          <ConflictItem
            key={`${conflict.entity}-${index}`}
            conflict={conflict}
            isSelected={selectedConflict === conflict}
            onSelect={() => setSelectedConflict(conflict)}
            onAcceptClient={() => handleResolveSingle(conflict, 'accept_client')}
            onAcceptServer={() => handleResolveSingle(conflict, 'accept_server')}
            getFieldDiff={getFieldDiff}
          />
        ))}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex gap-2">
          <button
            onClick={() => handleResolveAll('accept_client')}
            className="flex-1 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs font-medium text-yellow-800 hover:bg-yellow-100"
          >
            Accept all my changes
          </button>
          <button
            onClick={() => handleResolveAll('accept_server')}
            className="flex-1 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            Accept server version
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Conflict Item Sub-component
// ============================================================

interface ConflictItemProps {
  conflict: Conflict;
  isSelected: boolean;
  onSelect: () => void;
  onAcceptClient: () => void;
  onAcceptServer: () => void;
  getFieldDiff: (conflict: Conflict) => ConflictFieldDiff[];
}

function ConflictItem({
  conflict,
  isSelected,
  onSelect,
  onAcceptClient,
  onAcceptServer,
  getFieldDiff,
}: ConflictItemProps) {
  const diffs = getFieldDiff(conflict);
  const criticalCount = diffs.filter((d) => d.isCritical).length;

  return (
    <div className={isSelected ? 'bg-blue-50' : ''}>
      <button
        onClick={onSelect}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <div className="font-medium text-gray-900">
            {conflict.entity} conflict
          </div>
          <div className="text-xs text-gray-500">
            {diffs.length} field{diffs.length !== 1 ? 's' : ''} differ
            {criticalCount > 0 && (
              <span className="ml-1 text-red-600">
                ({criticalCount} critical)
              </span>
            )}
          </div>
        </div>
        <svg
          className={`h-5 w-5 text-gray-400 transition-transform ${isSelected ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isSelected && (
        <div className="px-4 pb-4">
          {/* Conflict Type Badge */}
          <div className="mb-3">
            {conflict.conflictType === 'concurrent' ? (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                Concurrent edit
              </span>
            ) : (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                Version conflict
              </span>
            )}
          </div>

          {/* Field Diffs */}
          <div className="space-y-2">
            {diffs.map((diff) => (
              <FieldDiffRow key={diff.field} diff={diff} />
            ))}
          </div>

          {/* Resolution Buttons */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={onAcceptClient}
              className="flex-1 rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              Accept mine
            </button>
            <button
              onClick={onAcceptServer}
              className="flex-1 rounded bg-gray-600 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700"
            >
              Accept server
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Field Diff Row
// ============================================================

function FieldDiffRow({ diff }: { diff: ConflictFieldDiff }) {
  const formatValue = (value: unknown): string => {
    if (value == null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <div
      className={`rounded border ${
        diff.isCritical
          ? 'border-red-200 bg-red-50'
          : 'border-yellow-200 bg-yellow-50'
      }`}
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-gray-700">{diff.field}</span>
        {diff.isCritical && (
          <span className="text-[10px] font-semibold uppercase text-red-600">
            Critical
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-px">
        <div className="bg-white p-2">
          <div className="text-[10px] uppercase text-gray-500">Yours</div>
          <div className="truncate text-xs text-blue-700" title={formatValue(diff.clientValue)}>
            {formatValue(diff.clientValue)}
          </div>
        </div>
        <div className="bg-white p-2">
          <div className="text-[10px] uppercase text-gray-500">Server</div>
          <div className="truncate text-xs text-gray-700" title={formatValue(diff.serverValue)}>
            {formatValue(diff.serverValue)}
          </div>
        </div>
      </div>
    </div>
  );
}
