import * as winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { config } from '../config'

function safeStringify(obj: any, indent: number = 2) {
  const cache = new Set();
  const result = JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          return '[Circular]';  // replace circular reference
        }
        cache.add(value);
      }
      return value;
    },
    indent
  );
  cache.clear();
  return result;
}

function createLogger(name: string) {
  const formats = [
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    config.USE_LOG_FILE ? winston.format.uncolorize() : winston.format.colorize() ,
    winston.format.printf((info) => {
      let message = `${info.timestamp} [${info.level} - ${name}]: ${info.message}`;
      if (info.stack) {
        message += `\nStack: ${info.stack}`;
      }
      if (info.response) {
        message += `\nResponse: ${safeStringify(info.response, 2)}`;
      }
      return message;
    })
  ]

  const logger = winston.createLogger({
    format: winston.format.combine(...formats),
    defaultMeta: { service: 'user-service' }
  })

  if (config.USE_LOG_FILE) {
    logger.add(
      new DailyRotateFile({
        level: 'error',
        dirname: 'logs',
        filename: `${name}_error.log`,
        zippedArchive: true
      })
    )
    logger.add(
      new DailyRotateFile({
        dirname: 'logs',
        filename: `${name}_combined.log`,
        zippedArchive: true
      })
    )
  }

  logger.add(new winston.transports.Console())
  return logger
}

export const executorLogger = createLogger('Executor')
export const outputLogger = createLogger('Output')
export const batchLogger = createLogger('Batch')
export const challengerLogger = createLogger('Challenger')
