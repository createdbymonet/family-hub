import { LIMITS, type NoteDto, type WishlistItemDto } from '../shared/contracts';
import {
  HttpError,
  json,
  readObject,
  rejectMethod,
  requireId,
  requireText,
  requireVersion,
} from './http';
import type { SessionContext } from './session';

interface EntryRow {
  id: string;
  author_id: string;
  author_name: string;
  title: string;
  memo?: string;
  body?: string;
  status: 'pending' | 'achieved' | 'open' | 'resolved';
  created_at: number;
  updated_at: number;
  achieved_at?: number | null;
  resolved_at?: number | null;
  version: number;
}

// Only these server-owned identifiers enter SQL; request values are always bound.
const DEFINITIONS = {
  wishes: {
    table: 'wishlist_items',
    text: 'memo',
    initial: 'pending',
    finished: 'achieved',
    timestamp: 'achieved_at',
    titleLimit: LIMITS.wishTitle,
  },
  notes: {
    table: 'notes',
    text: 'body',
    initial: 'open',
    finished: 'resolved',
    timestamp: 'resolved_at',
    titleLimit: LIMITS.noteTitle,
  },
} as const;
type EntryKind = keyof typeof DEFINITIONS;

function dto(kind: EntryKind, row: EntryRow): WishlistItemDto | NoteDto {
  const common = {
    id: row.id,
    title: row.title,
    authorId: row.author_id,
    authorName: row.author_name,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  return kind === 'wishes'
    ? {
        ...common,
        memo: row.memo!,
        status: row.status as WishlistItemDto['status'],
        achievedAt: row.achieved_at == null ? null : new Date(row.achieved_at).toISOString(),
      }
    : {
        ...common,
        body: row.body!,
        status: row.status as NoteDto['status'],
        resolvedAt: row.resolved_at == null ? null : new Date(row.resolved_at).toISOString(),
      };
}

function conflict(): never {
  throw new HttpError(409, 'CONFLICT', 'This entry has changed. Refresh the list and try again.');
}

async function entryRow(
  db: D1Database,
  kind: EntryKind,
  householdId: string,
  id: string,
): Promise<EntryRow> {
  const row = await db
    .prepare(
      `SELECT e.*, u.display_name AS author_name FROM ${DEFINITIONS[kind].table} e JOIN users u ON u.id = e.author_id WHERE e.id = ? AND e.household_id = ?`,
    )
    .bind(id, householdId)
    .first<EntryRow>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'The entry was not found.');
  return row;
}

function entryText(kind: EntryKind, value: unknown): string {
  if (kind === 'notes') return requireText(value, LIMITS.noteBody);
  if (typeof value !== 'string' || value.includes('\0') || value.trim().length > LIMITS.wishMemo) {
    throw new HttpError(
      400,
      'INVALID_INPUT',
      `Memo must contain at most ${LIMITS.wishMemo} characters.`,
    );
  }
  return value.trim();
}

export async function sharedEntriesApi(
  request: Request,
  env: Cloudflare.Env,
  session: SessionContext,
  kind: EntryKind,
  rawId?: string,
): Promise<Response> {
  const definition = DEFINITIONS[kind];
  const { table, text, initial, finished, timestamp } = definition;
  const db = env.DB;
  if (rawId === undefined) {
    if (request.method === 'GET') {
      const result = await db
        .prepare(
          `SELECT e.*, u.display_name AS author_name FROM ${table} e JOIN users u ON u.id = e.author_id WHERE e.household_id = ? ORDER BY CASE WHEN e.status = ? THEN 0 ELSE 1 END, e.updated_at DESC, e.id`,
        )
        .bind(session.householdId, initial)
        .all<EntryRow>();
      return json(result.results.map((row) => dto(kind, row)));
    }
    if (request.method !== 'POST') return rejectMethod();
    // Notes allow a bounded larger envelope so maximum-size Unicode bodies remain usable.
    const input = await readObject(
      request,
      ['id', 'title', text],
      kind === 'notes' ? 32_768 : 16_384,
    );
    const id = requireId(typeof input['id'] === 'string' ? input['id'] : '');
    const title = requireText(input['title'], definition.titleLimit);
    const content = entryText(kind, kind === 'wishes' && !(text in input) ? '' : input[text]);
    const now = Date.now();
    const inserted = await db
      .prepare(
        `INSERT INTO ${table}(id,household_id,author_id,title,${text},status,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING RETURNING id`,
      )
      .bind(id, session.householdId, session.userId, title, content, initial, now, now)
      .first<{ id: string }>();
    const row = await entryRow(db, kind, session.householdId, id);
    if (
      !inserted &&
      (row.author_id !== session.userId || row.title !== title || row[text] !== content)
    )
      return conflict();
    return json(dto(kind, row), inserted ? 201 : 200);
  }
  const id = requireId(rawId);
  if (request.method === 'GET')
    return json(dto(kind, await entryRow(db, kind, session.householdId, id)));
  if (request.method === 'PATCH') {
    const input = await readObject(
      request,
      ['version', 'title', text, 'status'],
      kind === 'notes' ? 32_768 : 16_384,
    );
    const version = requireVersion(input['version']);
    if (!['title', text, 'status'].some((key) => key in input))
      throw new HttpError(400, 'INVALID_INPUT', 'Provide text or a status.');
    const title = 'title' in input ? requireText(input['title'], definition.titleLimit) : null;
    const content = text in input ? entryText(kind, input[text]) : null;
    const status = 'status' in input ? input['status'] : null;
    if ('status' in input && status !== initial && status !== finished)
      throw new HttpError(400, 'INVALID_INPUT', 'Choose a supported status.');
    const now = Date.now();
    const updated = await db
      .prepare(
        `UPDATE ${table} SET title = coalesce(?,title), ${text} = coalesce(?,${text}), status = coalesce(?,status), ${timestamp} = CASE WHEN ? IS NULL THEN ${timestamp} WHEN ? = ? THEN NULL WHEN status = ? THEN ${timestamp} ELSE ? END, updated_at = ?, version = version + 1 WHERE id = ? AND household_id = ? AND version = ? RETURNING id`,
      )
      .bind(
        title,
        content,
        status as string | null,
        status as string | null,
        status as string | null,
        initial,
        finished,
        now,
        now,
        id,
        session.householdId,
        version,
      )
      .first<{ id: string }>();
    const row = await entryRow(db, kind, session.householdId, id);
    if (!updated) return conflict();
    return json(dto(kind, row));
  }
  if (request.method === 'DELETE') {
    const value = new URL(request.url).searchParams.get('version');
    const version = requireVersion(value && /^[1-9][0-9]*$/.test(value) ? Number(value) : null);
    const deleted = await db
      .prepare(
        `DELETE FROM ${table} WHERE id = ? AND household_id = ? AND version = ? RETURNING id`,
      )
      .bind(id, session.householdId, version)
      .first<{ id: string }>();
    if (deleted) return new Response(null, { status: 204 });
    await entryRow(db, kind, session.householdId, id);
    return conflict();
  }
  return rejectMethod();
}
