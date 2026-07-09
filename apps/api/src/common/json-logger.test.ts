import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonLogger, selectLogger } from './json-logger';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIXED = new Date('2026-07-08T00:00:00.000Z');
const fixedClock = () => FIXED;

/** Captures every line the logger writes to stdout AND stderr, without touching the real streams. */
function captureStreams() {
  const lines: { stream: 'out' | 'err'; text: string }[] = [];
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push({ stream: 'out', text: String(chunk) });
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    lines.push({ stream: 'err', text: String(chunk) });
    return true;
  });
  return { lines, restore: () => { out.mockRestore(); err.mockRestore(); } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JsonLogger', () => {
  it('emits a single-line JSON object with { level, time (ISO), context, message } for every level', () => {
    const cap = captureStreams();
    const logger = new JsonLogger(fixedClock);

    for (const level of ['log', 'warn', 'debug', 'verbose'] as const) {
      logger[level](`hello ${level}`, 'Bootstrap');
    }
    logger.error('boom', undefined, 'Bootstrap');
    cap.restore();

    // exactly one write per call, each terminated by exactly one trailing newline.
    expect(cap.lines).toHaveLength(5);
    for (const { text } of cap.lines) {
      expect(text.endsWith('\n')).toBe(true);
      expect(text.slice(0, -1)).not.toContain('\n'); // single line
      const rec = JSON.parse(text);
      expect(rec.time).toMatch(ISO);
      expect(rec.context).toBe('Bootstrap');
      expect(typeof rec.message).toBe('string');
    }
    expect(cap.lines.map((l) => JSON.parse(l.text).level)).toEqual([
      'log',
      'warn',
      'debug',
      'verbose',
      'error',
    ]);
  });

  it('encodes a multi-line message as single-line JSON (newline escaped, one trailing \\n)', () => {
    const cap = captureStreams();
    new JsonLogger(fixedClock).log('line one\nline two\r\nline three', 'MultiLine');
    cap.restore();

    expect(cap.lines).toHaveLength(1);
    const raw = cap.lines[0]!.text;
    // The record body carries no raw CR/LF — only the single terminating newline.
    expect(raw.slice(0, -1)).not.toMatch(/[\r\n]/);
    const rec = JSON.parse(raw); // must be parseable despite the newlines in the source message
    expect(rec.message).toBe('line one\nline two\r\nline three'); // round-trips, preserved
    expect(rec.context).toBe('MultiLine');
  });

  it('routes error to stderr and every other level to stdout', () => {
    const cap = captureStreams();
    const logger = new JsonLogger(fixedClock);
    logger.log('an info', 'Ctx');
    logger.warn('a warning', 'Ctx');
    logger.error('an error', undefined, 'Ctx');
    cap.restore();

    expect(cap.lines.map((l) => l.stream)).toEqual(['out', 'out', 'err']);
  });

  it('carries the error stack as an encoded field, still single-line', () => {
    const cap = captureStreams();
    new JsonLogger(fixedClock).error('failed', 'Error: nope\n    at foo (x.ts:1:1)', 'Ctx');
    cap.restore();

    const rec = JSON.parse(cap.lines[0]!.text);
    expect(rec.level).toBe('error');
    expect(rec.message).toBe('failed');
    expect(rec.stack).toBe('Error: nope\n    at foo (x.ts:1:1)');
    expect(cap.lines[0]!.text.slice(0, -1)).not.toContain('\n');
  });

  it('routes fatal to stderr with { level: "fatal" } and the same stack/context parsing as error', () => {
    const cap = captureStreams();
    const logger = new JsonLogger(fixedClock);
    logger.fatal('boom', 'Error: down\n    at boot (m.ts:9:1)', 'FatalCtx'); // [stack, context], like error
    logger.fatal('no stack here', 'OnlyCtx'); // [context] only — no stack param
    cap.restore();

    // error-severity stream split: fatal writes to stderr, mirroring error.
    expect(cap.lines.map((l) => l.stream)).toEqual(['err', 'err']);

    const withStack = JSON.parse(cap.lines[0]!.text);
    expect(withStack.level).toBe('fatal');
    expect(withStack.time).toMatch(ISO);
    expect(withStack.context).toBe('FatalCtx'); // trailing string param → context
    expect(withStack.message).toBe('boom');
    expect(withStack.stack).toBe('Error: down\n    at boot (m.ts:9:1)'); // preceding string → stack
    expect(cap.lines[0]!.text.slice(0, -1)).not.toContain('\n'); // stack collapsed to single line
    // same fixed allowlist as error — no extra fields.
    expect(Object.keys(withStack).sort()).toEqual(['context', 'level', 'message', 'stack', 'time']);

    const noStack = JSON.parse(cap.lines[1]!.text);
    expect(noStack.level).toBe('fatal');
    expect(noStack.context).toBe('OnlyCtx');
    expect(noStack.message).toBe('no stack here');
    expect(noStack.stack).toBeUndefined(); // no stack field when no stack param is present
  });

  it('defaults context to "Application" for a context-less call, and always emits the field', () => {
    const cap = captureStreams();
    new JsonLogger(fixedClock).log('no context here');
    cap.restore();

    const rec = JSON.parse(cap.lines[0]!.text);
    expect(rec.context).toBe('Application');
    expect(rec.message).toBe('no context here');
  });

  it('coerces a non-string message and never crashes on a circular payload (safe degrade)', () => {
    const cap = captureStreams();
    const logger = new JsonLogger(fixedClock);
    logger.log({ a: 1, b: 'two' }, 'Ctx'); // object → JSON string
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.log(circular, 'Ctx')).not.toThrow(); // must not throw from the logging path
    cap.restore();

    expect(JSON.parse(cap.lines[0]!.text).message).toBe('{"a":1,"b":"two"}');
    // second line is still a single parseable JSON object (degraded message, not a crash).
    const degraded = JSON.parse(cap.lines[1]!.text);
    expect(degraded.level).toBe('log');
    expect(cap.lines[1]!.text.slice(0, -1)).not.toContain('\n');
  });

  it('adds NO fields beyond the fixed allowlist (no-secret-leak: only reformats existing calls)', () => {
    const cap = captureStreams();
    new JsonLogger(fixedClock).error('m', 'stack', 'Ctx');
    cap.restore();

    const keys = Object.keys(JSON.parse(cap.lines[0]!.text)).sort();
    expect(keys).toEqual(['context', 'level', 'message', 'stack', 'time']);
  });

  // The highest-value test: prove the context/stack extraction against the REAL Nest forwarding
  // contract (the wrapper appends the instance's bound context as the trailing param), through the
  // same hook app.useLogger installs — not against an assumed call shape.
  it('extracts context + stack through the real Nest Logger.overrideLogger path', () => {
    const cap = captureStreams();
    const jsonLogger = new JsonLogger(fixedClock);
    Logger.overrideLogger(jsonLogger);
    try {
      new Logger('DomainExceptionFilter').error(
        'Unhandled error [requestId=abc-123]',
        'Error: boom\n    at handler (a.ts:2:3)',
      );
      new Logger('Bootstrap').log('Gilgamesh API listening on :3001/api/v1 (production)');
    } finally {
      Logger.overrideLogger(console); // restore the default console logger for the rest of the suite
      cap.restore();
    }

    const errLine = cap.lines.find((l) => l.stream === 'err');
    expect(errLine).toBeDefined();
    const err = JSON.parse(errLine!.text);
    expect(err.level).toBe('error');
    expect(err.context).toBe('DomainExceptionFilter'); // bound context, forwarded as trailing param
    expect(err.message).toContain('requestId=abc-123'); // requestId rides in the message (slice 24)
    expect(err.stack).toContain('at handler');
    expect(errLine!.text.slice(0, -1)).not.toContain('\n'); // stack collapsed to single line

    const outLine = cap.lines.find((l) => l.stream === 'out');
    const info = JSON.parse(outLine!.text);
    expect(info.level).toBe('log');
    expect(info.context).toBe('Bootstrap');
    expect(info.message).toContain('listening');
  });
});

describe('selectLogger', () => {
  it('returns a JsonLogger only for "json"', () => {
    const logger = selectLogger('json');
    expect(logger).toBeInstanceOf(JsonLogger);
  });

  it('returns undefined for "pretty" and anything else (keeps the Nest default logger untouched)', () => {
    // undefined = main.ts never calls app.useLogger = zero change to the pretty logger.
    expect(selectLogger('pretty')).toBeUndefined();
    expect(selectLogger(undefined as unknown as 'pretty')).toBeUndefined();
    expect(selectLogger('xml' as unknown as 'pretty')).toBeUndefined();
  });
});
