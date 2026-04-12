import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AppPage,
  FeedbackEventDTO,
  FeedbackEventLevel,
  FeedbackEventPriority,
  UserRole,
} from './types';

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

interface PilingStore {
  // Auth state
  currentUser: CurrentUser | null;
  currentPage: AppPage;
  selectedSiteId: string | null;
  localFeedbackEvents: FeedbackEventDTO[];

  // Auth actions
  login: (user: CurrentUser) => void;
  setCurrentUser: (user: CurrentUser) => void;
  logout: () => void;

  // Navigation
  navigate: (page: AppPage) => void;

  // Site selection
  setSelectedSite: (siteId: string | null) => void;

  // Feedback loops
  addLocalFeedbackEvent: (event: {
    level: FeedbackEventLevel;
    priority?: FeedbackEventPriority;
    scope: string;
    action: string;
    title: string;
    message: string;
    requestId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) => void;
  dismissLocalFeedbackEvent: (id: string) => void;
  clearLocalFeedbackEvents: () => void;
}

// Role-based default pages
function getDefaultPage(role: UserRole): AppPage {
  switch (role) {
    case 'ADMIN':
    case 'DISPATCHER':
      return 'admin-dashboard';
    case 'OPERATOR':
    case 'ASSISTANT':
    default:
      return 'operator-dashboard';
  }
}

export const usePilingStore = create<PilingStore>()(
  persist(
    (set) => ({
      currentUser: null,
      currentPage: 'login',
      selectedSiteId: null,
      localFeedbackEvents: [],

      login: (user: CurrentUser) => {
        set({
          currentUser: user,
          currentPage: getDefaultPage(user.role),
        });
      },

      setCurrentUser: (user: CurrentUser) => {
        set((state) => ({
          currentUser: user,
          currentPage:
            state.currentPage === 'login' ? getDefaultPage(user.role) : state.currentPage,
        }));
      },

      logout: () => {
        set({
          currentUser: null,
          currentPage: 'login',
          selectedSiteId: null,
          localFeedbackEvents: [],
        });
      },

      navigate: (page: AppPage) => {
        set({ currentPage: page });
      },

      setSelectedSite: (siteId: string | null) => {
        set({ selectedSiteId: siteId });
      },

      addLocalFeedbackEvent: (event) => {
        const priority =
          event.priority ||
          (event.level === 'error'
            ? 'CRITICAL'
            : event.level === 'warn'
              ? 'HIGH'
              : event.level === 'success'
                ? 'LOW'
                : 'MEDIUM');

        set((state) => ({
          localFeedbackEvents: [
            {
              id: crypto.randomUUID(),
              level: event.level,
              priority,
              scope: event.scope,
              action: event.action,
              title: event.title,
              message: event.message,
              audience: 'USER' as const,
              actorId: state.currentUser?.id || null,
              actorName: state.currentUser?.name || null,
              actorRole: state.currentUser?.role || null,
              targetId: null,
              requestId: event.requestId || null,
              metadata: event.metadata || null,
              readAt: null,
              acknowledgedAt: null,
              unread: true,
              source: 'client' as const,
              createdAt: new Date().toISOString(),
            },
            ...state.localFeedbackEvents,
          ].slice(0, 30),
        }));
      },

      dismissLocalFeedbackEvent: (id: string) => {
        set((state) => ({
          localFeedbackEvents: state.localFeedbackEvents.filter((event) => event.id !== id),
        }));
      },

      clearLocalFeedbackEvents: () => {
        set({ localFeedbackEvents: [] });
      },
    }),
    {
      name: 'piling-track-storage',
      partialize: (state) => ({
        currentUser: state.currentUser,
        selectedSiteId: state.selectedSiteId,
      }),
    }
  )
);
