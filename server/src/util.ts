import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 12 位小写字母数字 ID。 */
export function newId(): string {
  const bytes = randomBytes(12);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 36];
  return s;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export const notFound = (what = 'not_found') => new HttpError(404, 'not_found', what);
export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
