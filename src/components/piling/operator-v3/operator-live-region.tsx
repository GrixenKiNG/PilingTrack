export function OperatorLiveRegion({message}: {message: string | null}) {
  return <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{message}</p>;
}
