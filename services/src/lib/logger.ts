/**
 * Structured JSON logging.
 *
 * CloudWatch Logs Insights can query JSON fields directly, so every log line is
 * emitted as one JSON object rather than a formatted string. Alexander's M7
 * dashboards depend on this, which is why it exists from the first handler
 * rather than being retrofitted later.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  const line = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  });

  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};
