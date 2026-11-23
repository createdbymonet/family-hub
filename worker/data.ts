import {
  LIMITS,
  REACTION_OPTIONS,
  type ReactionCode,
  type ShoppingItemDto,
  type ThanksPostDto,
  type ThanksPostsPageDto,
} from '../shared/contracts';
import { decodeJson, encodeJson } from './crypto';
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

interface ShoppingRow {
  id: string;
  name: string;
  completed: number;
  version: number;
  created_at: number;
  updated_at: number;
}
interface PostRow {
  id: string;
  author_id: string;
  message: string;
  version: number;
  created_at: number;
  updated_at: number;
}
interface ReactionRow {
  post_id: string;
  user_id: string;
  reaction_code: ReactionCode;
}

function shoppingDto(row: ShoppingRow): ShoppingItemDto {
  return {
    id: row.id,
    name: row.name,
    completed: row.completed === 1,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function shoppingItem(db: D1Database, householdId: string, id: string): Promise<ShoppingRow> {
  const item = await db
    .prepare('SELECT * FROM shopping_items WHERE id = ? AND household_id = ?')
    .bind(id, householdId)
    .first<ShoppingRow>();
  if (!item) throw new HttpError(404, 'NOT_FOUND', 'The item was not found.');
  return item;
}

function conflict(): never {
  throw new HttpError(409, 'CONFLICT', 'This entry has changed. Refresh the list and try again.');
}

function deleteVersion(url: URL): number {
  const value = url.searchParams.get('version');
  if (!value || !/^[1-9][0-9]*$/.test(value)) return requireVersion(null);
  return requireVersion(Number(value));
}

export async function shoppingApi(
  request: Request,
  env: Cloudflare.Env,
  session: SessionContext,
  rawId?: string,
): Promise<Response> {
  const db = env.DB;
  if (rawId === undefined) {
    if (request.method === 'GET') {
      const rows = await db
        .prepare('SELECT * FROM shopping_items WHERE household_id = ? ORDER BY created_at, id')
        .bind(session.householdId)
        .all<ShoppingRow>();
      return json(rows.results.map(shoppingDto));
    }
    if (request.method !== 'POST') return rejectMethod();
    const input = await readObject(request, ['id', 'name']);
    const id = requireId(typeof input['id'] === 'string' ? input['id'] : '');
    const name = requireText(input['name'], LIMITS.shoppingName);
    const now = Date.now();
    const inserted = await db
      .prepare(
        `INSERT INTO shopping_items(id,household_id,name,completed,version,created_at,updated_at)
       VALUES(?,?,?,0,1,?,?) ON CONFLICT(id) DO NOTHING RETURNING *`,
      )
      .bind(id, session.householdId, name, now, now)
      .first<ShoppingRow>();
    if (inserted) return json(shoppingDto(inserted), 201);
    const existing = await shoppingItem(db, session.householdId, id);
    if (existing.name !== name) return conflict();
    return json(shoppingDto(existing));
  }
  const id = requireId(rawId);
  if (request.method === 'PATCH') {
    const input = await readObject(request, ['version', 'name', 'completed']);
    const version = requireVersion(input['version']);
    const hasName = 'name' in input;
    const hasCompleted = 'completed' in input;
    if (!hasName && !hasCompleted)
      throw new HttpError(400, 'INVALID_INPUT', 'Provide a name or completion state.');
    const name = hasName ? requireText(input['name'], LIMITS.shoppingName) : null;
    if (hasCompleted && typeof input['completed'] !== 'boolean') {
      throw new HttpError(400, 'INVALID_INPUT', 'Completion must be a boolean.');
    }
    const completed = hasCompleted ? (input['completed'] ? 1 : 0) : null;
    const item = await db
      .prepare(
        `UPDATE shopping_items SET name = coalesce(?,name), completed = coalesce(?,completed),
              version = version + 1, updated_at = ? WHERE id = ? AND household_id = ? AND version = ? RETURNING *`,
      )
      .bind(name, completed, Date.now(), id, session.householdId, version)
      .first<ShoppingRow>();
    if (item) return json(shoppingDto(item));
    await shoppingItem(db, session.householdId, id);
    return conflict();
  }
  if (request.method === 'DELETE') {
    const version = deleteVersion(new URL(request.url));
    const result = await db
      .prepare(
        'DELETE FROM shopping_items WHERE id = ? AND household_id = ? AND version = ? RETURNING id',
      )
      .bind(id, session.householdId, version)
      .first<{ id: string }>();
    if (result) return new Response(null, { status: 204 });
    await shoppingItem(db, session.householdId, id);
    return conflict();
  }
  return rejectMethod();
}

async function postRow(db: D1Database, householdId: string, id: string): Promise<PostRow> {
  const post = await db
    .prepare('SELECT * FROM thanks_posts WHERE id = ? AND household_id = ?')
    .bind(id, householdId)
    .first<PostRow>();
  if (!post) throw new HttpError(404, 'NOT_FOUND', 'The post was not found.');
  return post;
}

async function postDtos(db: D1Database, posts: readonly PostRow[]): Promise<ThanksPostDto[]> {
  if (posts.length === 0) return [];
  // IDs originate from the scoped SELECT, while each ID is still parameter-bound.
  const placeholders = posts.map(() => '?').join(',');
  const reactions = await db
    .prepare(
      `SELECT post_id,user_id,reaction_code FROM thanks_reactions WHERE post_id IN (${placeholders}) ORDER BY user_id,reaction_code`,
    )
    .bind(...posts.map((post) => post.id))
    .all<ReactionRow>();
  return posts.map((row) => ({
    id: row.id,
    authorId: row.author_id,
    message: row.message,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    reactions: reactions.results
      .filter((reaction) => reaction.post_id === row.id)
      .map((reaction) => ({ userId: reaction.user_id, code: reaction.reaction_code })),
  }));
}

async function onePostDto(db: D1Database, row: PostRow): Promise<ThanksPostDto> {
  const posts = await postDtos(db, [row]);
  return posts[0]!;
}

function cursor(value: string | null): { time: number; id: string } | null {
  if (value === null) return null;
  try {
    const decoded = decodeJson(value);
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      !Number.isSafeInteger(decoded[0]) ||
      decoded[0] < 0 ||
      typeof decoded[1] !== 'string'
    )
      throw new Error();
    return { time: decoded[0] as number, id: requireId(decoded[1]) };
  } catch {
    throw new HttpError(400, 'INVALID_INPUT', 'The page cursor is invalid.');
  }
}

export async function thanksApi(
  request: Request,
  env: Cloudflare.Env,
  session: SessionContext,
  rawId?: string,
  rawCode?: string,
): Promise<Response> {
  const db = env.DB;
  if (rawId === undefined) {
    if (request.method === 'GET') {
      const before = cursor(new URL(request.url).searchParams.get('before'));
      const result = before
        ? await db
            .prepare(
              `SELECT * FROM thanks_posts WHERE household_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT 51`,
            )
            .bind(session.householdId, before.time, before.time, before.id)
            .all<PostRow>()
        : await db
            .prepare(
              'SELECT * FROM thanks_posts WHERE household_id = ? ORDER BY created_at DESC,id DESC LIMIT 51',
            )
            .bind(session.householdId)
            .all<PostRow>();
      const page = result.results.slice(0, 50);
      const oldest = page.at(-1);
      const nextCursor =
        result.results.length > 50 && oldest ? encodeJson([oldest.created_at, oldest.id]) : null;
      const body: ThanksPostsPageDto = { posts: await postDtos(db, page.reverse()), nextCursor };
      return json(body);
    }
    if (request.method !== 'POST') return rejectMethod();
    const input = await readObject(request, ['id', 'message']);
    const id = requireId(typeof input['id'] === 'string' ? input['id'] : '');
    const message = requireText(input['message'], LIMITS.thanksMessage);
    const now = Date.now();
    const inserted = await db
      .prepare(
        `INSERT INTO thanks_posts(id,household_id,author_id,message,created_at,updated_at,version)
       VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING RETURNING *`,
      )
      .bind(id, session.householdId, session.userId, message, now, now)
      .first<PostRow>();
    if (inserted) return json(await onePostDto(db, inserted), 201);
    const existing = await postRow(db, session.householdId, id);
    if (existing.author_id !== session.userId || existing.message !== message) return conflict();
    return json(await onePostDto(db, existing));
  }
  const id = requireId(rawId);
  if (rawCode !== undefined) {
    if (request.method !== 'PUT' && request.method !== 'DELETE') return rejectMethod();
    if (!REACTION_OPTIONS.some((option) => option.code === rawCode)) {
      throw new HttpError(400, 'INVALID_INPUT', 'Choose a supported reaction.');
    }
    const post = await postRow(db, session.householdId, id);
    if (request.method === 'PUT') {
      await db
        .prepare(
          `INSERT INTO thanks_reactions(post_id,user_id,reaction_code)
         SELECT id,?,? FROM thanks_posts WHERE id = ? AND household_id = ? ON CONFLICT DO NOTHING`,
        )
        .bind(session.userId, rawCode, id, session.householdId)
        .run();
    } else {
      await db
        .prepare(
          `DELETE FROM thanks_reactions WHERE post_id = ? AND user_id = ? AND reaction_code = ?
         AND EXISTS(SELECT 1 FROM thanks_posts WHERE id = ? AND household_id = ?)`,
        )
        .bind(id, session.userId, rawCode, id, session.householdId)
        .run();
    }
    // Re-read to detect a post deleted concurrently with a reaction change.
    return json(await onePostDto(db, await postRow(db, session.householdId, post.id)));
  }
  if (request.method !== 'PATCH' && request.method !== 'DELETE') return rejectMethod();
  const current = await postRow(db, session.householdId, id);
  if (current.author_id !== session.userId)
    throw new HttpError(403, 'FORBIDDEN', 'Only the author can change this post.');
  if (request.method === 'PATCH') {
    const input = await readObject(request, ['version', 'message']);
    const version = requireVersion(input['version']);
    const message = requireText(input['message'], LIMITS.thanksMessage);
    const updated = await db
      .prepare(
        `UPDATE thanks_posts SET message = ?,updated_at = ?,version = version + 1
       WHERE id = ? AND household_id = ? AND author_id = ? AND version = ? RETURNING *`,
      )
      .bind(message, Date.now(), id, session.householdId, session.userId, version)
      .first<PostRow>();
    if (updated) return json(await onePostDto(db, updated));
  } else {
    const version = deleteVersion(new URL(request.url));
    const deleted = await db
      .prepare(
        'DELETE FROM thanks_posts WHERE id = ? AND household_id = ? AND author_id = ? AND version = ? RETURNING id',
      )
      .bind(id, session.householdId, session.userId, version)
      .first<{ id: string }>();
    if (deleted) return new Response(null, { status: 204 });
  }
  await postRow(db, session.householdId, id);
  return conflict();
}
