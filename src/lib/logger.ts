type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function write(level: LogLevel, message: string, fields?: LogFields) {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Structured JSON logger for serverless (Vercel-friendly).
 */
export const logger = {
  debug(message: string, fields?: LogFields) {
    if (process.env.NODE_ENV === "development") {
      write("debug", message, fields);
    }
  },
  info(message: string, fields?: LogFields) {
    write("info", message, fields);
  },
  warn(message: string, fields?: LogFields) {
    write("warn", message, fields);
  },
  error(message: string, fields?: LogFields) {
    write("error", message, fields);
  },
};

/**
 * Capture an exception. When SENTRY_DSN is set, also reports to Sentry (lazy).
 */
export async function captureException(
  error: unknown,
  fields?: LogFields
): Promise<void> {
  const err =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Unknown error");

  logger.error(err.message, {
    ...fields,
    name: err.name,
    stack: err.stack,
  });

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    const Sentry = await import("@sentry/node");
    if (!Sentry.getClient()) {
      Sentry.init({
        dsn,
        tracesSampleRate: 0,
        defaultIntegrations: false,
      });
    }
    Sentry.captureException(err, { extra: fields });
    await Sentry.flush(1_500);
  } catch (sentryError) {
    logger.warn("sentry_capture_failed", {
      error:
        sentryError instanceof Error
          ? sentryError.message
          : String(sentryError),
    });
  }
}

export function createRequestId() {
  return crypto.randomUUID();
}
