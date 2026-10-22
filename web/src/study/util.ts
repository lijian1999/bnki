/** 接口错误时提示用的文字。 */
export function errText(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' && e.message ? e.message : '操作失败';
}
