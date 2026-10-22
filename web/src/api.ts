// HTTP 请求层：每个接口一个方法，路径与字段见 docs/contracts.md 第 3 节。
import type {
  CardColor, CardItem, CardState, CardType, DeckSort, DeckSummary, Folder, ID, Item, QueueEntry, Rating, Settings, StudyContent,
} from '@bnki/shared';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** 统计接口（contracts 3.5）的返回结构。 */
export interface Stats {
  today: number;
  total: number;
  deckCount: number;
  cardCount: number;
  streak: number;
  best: { days: number; start: string | null; end: string | null };
  monthDays: number;
  calendar: Record<string, number>;
  series: { date: string; reviews: number; edits: number }[];
  forecast: { date: string; count: number }[];
  retention: { actual: number | null; target: number; samples: number };
}

export interface DeckListParams {
  view?: 'all' | 'recent' | 'trash';
  folder?: string;
  sort?: DeckSort;
  q?: string;
}

export interface DeckPatch {
  title?: string;
  description?: string;
  folderId?: ID | null;
  cover?: string | null;
  pinned?: boolean;
  studyCfg?: DeckSummary['studyCfg'];
  displayCfg?: DeckSummary['displayCfg'];
}

export interface ItemCreateBody {
  deckId: ID;
  kind: 'section' | 'card';
  afterId?: ID | null;
  level?: 1 | 2 | 3 | 4 | 5;
  title?: string;
  cardType?: CardType;
  front?: string;
  hint?: string;
  back?: string;
  color?: CardColor;
}

export interface ItemPatch {
  title?: string;
  level?: 1 | 2 | 3 | 4 | 5;
  collapsed?: boolean;
  cardType?: CardType;
  front?: string;
  hint?: string;
  back?: string;
  color?: CardColor;
}

export interface SessionResult {
  label: string;
  queue: QueueEntry[];
  cards: CardItem[];
}

export interface ReviewResult {
  state: CardState | null;
  label: string;
  requeue: boolean;
}

/** 查询参数：undefined / 空串 不参与拼接。 */
function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = '';
    let message = '';
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      code = j.error ?? '';
      message = j.message ?? '';
    } catch {
      // 非 JSON 的错误响应，留空
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return handle<T>(res);
}

export const api = {
  folders: {
    list: () => request<Folder[]>('GET', '/api/folders'),
    create: (name: string) => request<Folder>('POST', '/api/folders', { name }),
    update: (id: ID, patch: { name?: string; position?: number }) => request<Folder>('PATCH', `/api/folders/${id}`, patch),
    remove: (id: ID) => request<{ ok: true }>('DELETE', `/api/folders/${id}`),
  },
  decks: {
    list: (params?: DeckListParams) => request<DeckSummary[]>('GET', `/api/decks${qs({ ...(params ?? {}) })}`),
    get: (id: ID) => request<DeckSummary>('GET', `/api/decks/${id}`),
    create: (body?: { title?: string; folderId?: ID | null }) => request<DeckSummary>('POST', '/api/decks', body ?? {}),
    update: (id: ID, patch: DeckPatch) => request<DeckSummary>('PATCH', `/api/decks/${id}`, patch),
    open: (id: ID) => request<{ ok: true }>('POST', `/api/decks/${id}/open`),
    forgetRecent: (id: ID) => request<{ ok: true }>('POST', `/api/decks/${id}/forget-recent`),
    remove: (id: ID) => request<{ ok: true }>('DELETE', `/api/decks/${id}`),
    restore: (id: ID) => request<DeckSummary>('POST', `/api/decks/${id}/restore`),
    purge: (id: ID) => request<{ ok: true }>('DELETE', `/api/decks/${id}/purge`),
    emptyTrash: () => request<{ ok: true }>('DELETE', '/api/trash'),
    duplicate: (id: ID) => request<DeckSummary>('POST', `/api/decks/${id}/duplicate`),
    resetProgress: (id: ID) => request<{ ok: true }>('POST', `/api/decks/${id}/reset-progress`),
  },
  items: {
    list: (deckId: ID) => request<Item[]>('GET', `/api/decks/${deckId}/items`),
    create: (body: ItemCreateBody) => request<Item>('POST', '/api/items', body),
    update: (id: ID, patch: ItemPatch) => request<Item>('PATCH', `/api/items/${id}`, patch),
    remove: (ids: ID[]) => request<{ ok: true }>('POST', '/api/items/delete', { ids }),
    restore: (ids: ID[]) => request<{ ok: true }>('POST', '/api/items/restore', { ids }),
    move: (body: { ids: ID[]; afterId: ID | null; deckId?: ID }) => request<{ ok: true }>('POST', '/api/items/move', body),
    duplicate: (id: ID) => request<Item>('POST', `/api/items/${id}/duplicate`),
  },
  study: {
    session: (deckId: ID, content?: StudyContent) => request<SessionResult>('POST', `/api/study/${deckId}/session`, content ? { content } : {}),
    review: (body: { cardId: ID; rating: Rating; durationMs?: number; practice?: boolean }) => request<ReviewResult>('POST', '/api/study/review', body),
    manual: (body: { cardId: ID; action: 'due' | 'master' | 'unmaster' | 'forget'; due?: number }) => request<{ state: CardState | null }>('POST', '/api/study/manual', body),
    preview: (cardId: ID) => request<{ previews: Record<number, string> }>('GET', `/api/study/preview/${cardId}`),
  },
  stats: (range: number) => request<Stats>('GET', `/api/stats${qs({ range })}`),
  settings: {
    get: () => request<Settings>('GET', '/api/settings'),
    put: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', patch),
  },
  media: {
    /** multipart 上传；字段名固定为 file。 */
    upload: async (file: Blob, filename?: string): Promise<{ path: string }> => {
      const fd = new FormData();
      fd.append('file', file, filename);
      const res = await fetch('/api/media', { method: 'POST', body: fd });
      return handle<{ path: string }>(res);
    },
  },
  io: {
    importText: (body: { deckId: ID; text: string; format: 'tsv' | 'csv'; firstColumnIsSection: boolean }) =>
      request<{ cards: number; sections: number }>('POST', '/api/import/text', body),
    importMarkdown: (body: { deckId: ID; text: string; split: 'item' | 'paragraph' | 'hr' }) =>
      request<{ cards: number; sections: number }>('POST', '/api/import/markdown', body),
    importApkg: async (deckId: ID, file: Blob): Promise<{ cards: number; sections: number }> => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/import/apkg${qs({ deckId })}`, { method: 'POST', body: fd });
      return handle<{ cards: number; sections: number }>(res);
    },
    /** 导出下载链接；format: md|html|csv|json，cloze: keep|answer，sections: 逗号分隔的目录 id。 */
    exportUrl: (deckId: ID, params: { format: string; cloze?: string; sections?: string }) =>
      `/api/export/${deckId}${qs(params)}`,
  },
  backups: {
    list: () => request<{ name: string; createdAt: number; size: number }[]>('GET', '/api/backups'),
    create: () => request<{ name: string }>('POST', '/api/backup'),
    restore: (name: string) => request<{ ok: true }>('POST', '/api/restore', { name }),
  },
};
