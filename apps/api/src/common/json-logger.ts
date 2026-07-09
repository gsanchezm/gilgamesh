import type { LoggerService } from '@nestjs/common';
import type { LogFormat } from '../config';

/**
 * Structured JSON logger (slice 30). Emits ONE single-line JSON object per log call so Azure Log
 * Analytics (which ingests container stdout/stderr line-by-line) can parse `level`/`time`/`context`/
 * `message` as queryable fields. Selected in `main.ts` via `app.useLogger(...)` only when
 * `LOG_FORMAT=json`; the default (unset/`pretty`) keeps Nest's human `ConsoleLogger` untouched.
 *
 * This is a pure REFORMATTER: it adds no new data to logs (no env, headers, cookies or bodies), only
 * re-encodes the message/context/stack of the existing Nest log calls. The request correlation id
 * (slice 24) already rides inside the message on the one place it is logged (the exception filter's
 * `Unhandled error [requestId=<id>]`), so no request-scoped plumbing is needed here.
 */

type Level = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

/** Levels that carry error severity: routed to stderr and parsed for a trailing stack param. */
function isErrorLevel(level: Level): boolean {
  return level === 'error' || level === 'fatal';
}

/** Label for a context-less log call, so the `context` field is always present. */
const DEFAULT_CONTEXT = 'Application';

interface LogRecord {
  level: Level;
  time: string;
  context: string;
  message: string;
  /** Present only for `error`/`fatal` calls that carry a stack/trace param. */
  stack?: string;
}

export class JsonLogger implements LoggerService {
  /** The clock is injectable so tests can assert a deterministic `time`. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams);
  }

  /**
   * Nest's `LoggerService.fatal?` (v11). Same shape as `error` — routed to stderr and parsed for a
   * trailing stack param — so an unrecoverable-failure log is machine-parseable at error severity.
   */
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, optionalParams);
  }

  private emit(level: Level, message: unknown, optionalParams: unknown[]): void {
    // Nest's `Logger` wrapper appends the instance's bound context as the TRAILING param (verified
    // against @nestjs/common v11 source + a `Logger.overrideLogger` test): `[context]` for
    // log/warn/debug/verbose, `[stack?, context]` for error/fatal. So the last string param is the
    // context, and — for the error-severity levels — the preceding string is the stack.
    const params = [...optionalParams];
    let context = DEFAULT_CONTEXT;
    if (params.length > 0 && typeof params[params.length - 1] === 'string') {
      context = params.pop() as string;
    }
    let stack: string | undefined;
    if (isErrorLevel(level) && params.length > 0 && typeof params[params.length - 1] === 'string') {
      stack = params[params.length - 1] as string;
    }

    const record: LogRecord = {
      level,
      time: this.now().toISOString(),
      context,
      message: coerceMessage(message),
    };
    if (stack !== undefined) {
      record.stack = stack;
    }

    // `JSON.stringify` escapes any embedded newline (`\n` -> `\\n`), so a multi-line message or a
    // stack trace collapses to a single ingestion line; the one trailing `\n` terminates the record.
    // `error`/`fatal` -> stderr, everything else -> stdout, mirroring Nest's ConsoleLogger stream split
    // so the platform preserves error severity.
    const stream = isErrorLevel(level) ? process.stderr : process.stdout;
    stream.write(`${serialize(record)}\n`);
  }
}

/** Coerces any Nest message into a string for the JSON `message` field, never throwing. */
function coerceMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message); // e.g. a circular object -> "[object Object]", still safe.
  }
}

/**
 * Serialises the record, guaranteeing the logging path can never throw (a broken log call must not
 * take down a request). Every field is already a primitive string here, so this only guards against
 * a future record-shape change.
 */
function serialize(record: LogRecord): string {
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({
      level: record.level,
      time: record.time,
      context: record.context,
      message: '[unserializable log payload]',
    });
  }
}

/**
 * Selects the logger override for the given format. Returns a {@link JsonLogger} ONLY for `json`;
 * returns `undefined` for `pretty` (and anything else) so `main.ts` never calls `app.useLogger` and
 * Nest's default pretty `ConsoleLogger` stays in force — the zero-change guarantee for dev/tests.
 */
export function selectLogger(logFormat: LogFormat): LoggerService | undefined {
  return logFormat === 'json' ? new JsonLogger() : undefined;
}
