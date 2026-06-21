/**
 * Re-export facade. The implementation moved to @/lib/service-error so that
 * core/ and modules/ can import it without crossing layer boundaries. Existing
 * services/ and app/ callers keep importing from here unchanged.
 */
export { ServiceError } from '@/lib/service-error';
