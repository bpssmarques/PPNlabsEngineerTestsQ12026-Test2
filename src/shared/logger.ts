export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogPayload {
  message: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function normalizeLogLevel(value: string | undefined): LogLevel {
  if (!value) {
    return "info";
  }

  const normalized = value.toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return "info";
}

function serializeContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }

  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value instanceof Error) {
      serialized[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
      continue;
    }

    serialized[key] = value;
  }

  return serialized;
}

function writeLog(level: LogLevel, scope: string, payload: LogPayload): void {
  const threshold = normalizeLogLevel(process.env.LOG_LEVEL);
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[threshold]) {
    return;
  }

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    scope,
    message: payload.message,
    ...(payload.context ? { context: serializeContext(payload.context) } : {})
  });

  if (level === "error") {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
}

export function createLogger(scope: string): Logger {
  return {
    debug(message, context) {
      writeLog("debug", scope, { message, context });
    },
    info(message, context) {
      writeLog("info", scope, { message, context });
    },
    warn(message, context) {
      writeLog("warn", scope, { message, context });
    },
    error(message, context) {
      writeLog("error", scope, { message, context });
    }
  };
}
