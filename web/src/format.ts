// 日期格式化：文案照原型 fmtDate / fmtMD。
function date(t?: number | null): Date | null {
  return t ? new Date(t) : null;
}

export function fmtDate(t?: number | null): string {
  const d = date(t);
  return d ? `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}` : '—';
}

export function fmtMonthDay(t?: number | null): string {
  const d = date(t);
  return d ? `${d.getMonth() + 1}月${d.getDate()}日` : '—';
}

export function fmtMDHM(t?: number | null): string {
  const d = date(t);
  return d
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : '—';
}
