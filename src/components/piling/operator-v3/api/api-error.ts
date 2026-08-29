export class OperatorV3ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'НЕИЗВЕСТНАЯ_ОШИБКА',
    public readonly status: number = 0,
  ) {
    super(message);
    this.name = 'OperatorV3ApiError';
  }
}

export function safeOperatorError(error: unknown): string {
  if (error instanceof OperatorV3ApiError) return error.message;
  return 'Не удалось загрузить рабочее место. Проверьте связь и повторите попытку';
}
