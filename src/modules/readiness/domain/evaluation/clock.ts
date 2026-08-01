export interface EvaluationClock {
  now(): Date;
}

export function capturedClock(value: Date): EvaluationClock {
  const captured = new Date(value.getTime());
  return {now: () => new Date(captured.getTime())};
}
