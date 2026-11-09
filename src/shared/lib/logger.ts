type LogLevel = 'info' | 'warn' | 'error';

interface LogEvent {
  level: LogLevel;
  event: string;
  code?: string;
  metrics?: Record<string, number | string | boolean | string[]>;
}

function emit(entry: LogEvent): void {
  const safe = JSON.stringify({ ...entry, at: new Date().toISOString() });
  if (entry.level === 'error') console.error(safe);
  else if (entry.level === 'warn') console.warn(safe);
}

export const logger = {
  warn(
    event: string,
    code?: string,
    metrics?: Record<string, number | string | boolean | string[]>,
  ) {
    emit({
      level: 'warn',
      event,
      ...(code === undefined ? {} : { code }),
      ...(metrics ? { metrics } : {}),
    });
  },
  error(event: string, code?: string) {
    emit(code === undefined ? { level: 'error', event } : { level: 'error', event, code });
  },
};
