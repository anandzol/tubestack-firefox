/**
 * Structured logger for YouTube Subscription Manager.
 * All modules use this for consistent, traceable output.
 * 
 * Usage: import { log } from './logger.js';
 *        log.info('ModuleName', 'message', { optional: 'data' });
 *        log.error('ModuleName', 'message', error);
 */

const PREFIX = 'YTSM';

function fmt(module, level, msg) {
  return `[${PREFIX}:${module}] [${level.toUpperCase()}] ${msg}`;
}

export const log = {
  info(module, msg, data) {
    try { console.log(fmt(module, 'info', msg), data !== undefined ? data : ''); } catch (_) { /* context dead */ }
  },
  warn(module, msg, data) {
    try { console.warn(fmt(module, 'warn', msg), data !== undefined ? data : ''); } catch (_) { /* context dead */ }
  },
  error(module, msg, data) {
    try { console.error(fmt(module, 'error', msg), data !== undefined ? data : ''); } catch (_) { /* context dead */ }
  },
  debug(module, msg, data) {
    try { console.debug(fmt(module, 'debug', msg), data !== undefined ? data : ''); } catch (_) { /* context dead */ }
  },
  /** Log a timed operation */
  async time(module, label, fn) {
    const start = performance.now();
    try {
      const result = await fn();
      const ms = (performance.now() - start).toFixed(1);
      log.info(module, `${label} completed in ${ms}ms`);
      return result;
    } catch (err) {
      const ms = (performance.now() - start).toFixed(1);
      log.error(module, `${label} failed after ${ms}ms`, err);
      throw err;
    }
  },
};
