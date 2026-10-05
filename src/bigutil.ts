import { AppError } from './errors.js';
import { MAX_INTEGER_DIGITS } from './limits.js';

const INTEGER_RE = /^[+-]?\d+$/;

/**
 * 规范化十进制整数字符串并转成 BigInt。
 * 不接受科学计数法、小数、空串、十六进制等形式。
 */
export function parseInteger(raw: unknown): bigint {
  if (typeof raw !== 'string') {
    throw new AppError('INVALID_INTEGER', '权重必须是十进制字符串', { received: typeof raw });
  }
  const s = raw.trim();
  if (s.length === 0 || !INTEGER_RE.test(s)) {
    throw new AppError('INVALID_INTEGER', '不合法的十进制整数字符串', { received: raw });
  }
  const digits = s.replace(/^[+-]/, '');
  const significant = digits.replace(/^0+/, '');
  if (significant.length > MAX_INTEGER_DIGITS) {
    throw new AppError('INTEGER_TOO_LARGE', `整数位数超过上限 ${MAX_INTEGER_DIGITS} 位`, {
      received: raw,
    });
  }
  try {
    return BigInt(s);
  } catch {
    throw new AppError('INVALID_INTEGER', '不合法的十进制整数字符串', { received: raw });
  }
}

/** BigInt 转十进制字符串（BigInt.prototype.toString 本身即十进制）。 */
export function formatInteger(value: bigint): string {
  return value.toString(10);
}
