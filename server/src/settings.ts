// 全局设置：settings 表里每个键存一份 JSON，缺的键用 DEFAULT_SETTINGS。
import { DEFAULT_SETTINGS, type Settings } from '@bnki/shared';
import type { DB } from './db';
import { badRequest } from './util';

export function getSettings(db: DB, dataDir = ''): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, dataDir };
  for (const r of db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]) {
    if (r.key in DEFAULT_SETTINGS && r.key !== 'dataDir') {
      try { (out as any)[r.key] = JSON.parse(r.value); } catch { /* 坏值忽略 */ }
    }
  }
  return out;
}

const ENUMS: Partial<Record<keyof Settings, readonly unknown[]>> = {
  defaultMode: ['daily', 'flexible', 'sprint'],
  fontSize: ['small', 'default', 'large', 'xlarge'],
  dayHour: [0, 2, 4, 6],
  steps: [1, 5, 10, 30],
  theme: ['light', 'dark', 'system'],
  homeSort: ['name', 'updated', 'created', 'studied', 'next_due', 'card_count', 'fresh_count'],
  lastCardType: ['note', 'qa', 'topic'],
  ttsScope: ['visible', 'card'],
  ttsLangFilter: ['all', 'foreign'],
  ttsMode: ['once', 'continuous', 'loop'],
};
const RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  newPerDay: [0, 9999], reviewPerDay: [0, 99999], retention: [0.8, 0.97], maxIvl: [1, 36500], ttsRate: [0.5, 2],
};

/** 部分更新。未知键、类型不对、超出范围都报 400。返回更新后的完整设置。 */
export function putSettings(db: DB, patch: Partial<Settings>, dataDir = ''): Settings {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch ?? {})) {
      const key = k as keyof Settings;
      if (key === 'dataDir') continue;
      if (!(key in DEFAULT_SETTINGS)) throw badRequest(`unknown setting: ${k}`);
      if (typeof v !== typeof DEFAULT_SETTINGS[key]) throw badRequest(`bad type: ${k}`);
      if (ENUMS[key] && !ENUMS[key]!.includes(v)) throw badRequest(`bad value: ${k}`);
      const r = RANGES[key];
      if (r && ((v as number) < r[0] || (v as number) > r[1])) throw badRequest(`out of range: ${k}`);
      stmt.run(key, JSON.stringify(v));
    }
  });
  tx();
  return getSettings(db, dataDir);
}
