export type QueryState =
  | { status: 'loading'; message?: string }
  | { status: 'error'; message: string }
  | { status: 'forbidden'; message?: string }
  | { status: 'feature-off'; message?: string }
  | { status: 'ready' };

export const READY_QUERY_STATE: QueryState = Object.freeze({ status: 'ready' });
