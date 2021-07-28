// Simple logging utility

const CATEGORIES = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5
} as const;

export class Logger {
  public static get categories() {
    return CATEGORIES;
  }

  public static level = getLevelFromEnv() ?? CATEGORIES.info;

  static log(level: keyof typeof CATEGORIES, fn: LoggerCallback) {
    if (Logger.level >= CATEGORIES[level]) {
      console.log(fn());
    }
  }

  static error(fn: LoggerCallback) {
    this.log('error', fn);
  }

  static warn(fn: LoggerCallback) {
    this.log('warn', fn);
  }

  static info(fn: LoggerCallback) {
    this.log('info', fn);
  }

  static debug(fn: LoggerCallback) {
    this.log('debug', fn);
  }

  static trace(fn: LoggerCallback) {
    this.log('trace', fn);
  }
}

export interface LoggerCallback {
  (): string
}

function getLevelFromEnv() {
  return (process.env.LOGGER_LEVEL && CATEGORIES[process.env.LOGGER_LEVEL as keyof typeof CATEGORIES]);
}