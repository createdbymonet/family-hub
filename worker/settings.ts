import {
  DEFAULT_USER_SETTINGS,
  THEMES,
  type ThemeName,
  type UserSettingsDto,
} from '../shared/contracts';
import { HttpError, json, readObject, rejectMethod, requireVersion } from './http';
import type { SessionContext } from './session';

interface SettingsRow {
  theme: ThemeName;
  show_completed_shopping_items: number;
  show_achieved_wishes: number;
  show_resolved_notes: number;
  version: number;
}

function dto(row: SettingsRow): UserSettingsDto {
  return {
    theme: row.theme,
    showCompletedShoppingItems: row.show_completed_shopping_items === 1,
    showAchievedWishes: row.show_achieved_wishes === 1,
    showResolvedNotes: row.show_resolved_notes === 1,
    version: row.version,
  };
}

export async function settingsApi(
  request: Request,
  env: Cloudflare.Env,
  session: SessionContext,
): Promise<Response> {
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?')
      .bind(session.userId)
      .first<SettingsRow>();
    return json(row ? dto(row) : DEFAULT_USER_SETTINGS);
  }
  if (request.method !== 'PATCH') return rejectMethod();
  const preferences = [
    'showCompletedShoppingItems',
    'showAchievedWishes',
    'showResolvedNotes',
  ] as const;
  const input = await readObject(request, ['version', 'theme', ...preferences]);
  const version = requireVersion(input['version']);
  if (!['theme', ...preferences].some((key) => key in input))
    throw new HttpError(400, 'INVALID_INPUT', 'Provide a preference to change.');
  if ('theme' in input && !THEMES.some((theme) => theme.id === input['theme']))
    throw new HttpError(400, 'INVALID_INPUT', 'Choose a supported theme.');
  for (const key of preferences) {
    if (key in input && typeof input[key] !== 'boolean')
      throw new HttpError(400, 'INVALID_INPUT', 'Display preferences must be booleans.');
  }
  // Missing preference rows behave as version 1. Concurrent first saves still use one CAS update.
  await env.DB.prepare(
    'INSERT INTO user_settings(user_id,updated_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING',
  )
    .bind(session.userId, Date.now())
    .run();
  const booleanValue = (key: (typeof preferences)[number]) =>
    key in input ? (input[key] ? 1 : 0) : null;
  const row = await env.DB.prepare(
    `UPDATE user_settings SET theme = coalesce(?,theme), show_completed_shopping_items = coalesce(?,show_completed_shopping_items), show_achieved_wishes = coalesce(?,show_achieved_wishes), show_resolved_notes = coalesce(?,show_resolved_notes), updated_at = ?, version = version + 1 WHERE user_id = ? AND version = ? RETURNING *`,
  )
    .bind(
      'theme' in input ? (input['theme'] as string) : null,
      booleanValue('showCompletedShoppingItems'),
      booleanValue('showAchievedWishes'),
      booleanValue('showResolvedNotes'),
      Date.now(),
      session.userId,
      version,
    )
    .first<SettingsRow>();
  if (!row)
    throw new HttpError(
      409,
      'CONFLICT',
      'Your settings changed on another device. Refresh and try again.',
    );
  return json(dto(row));
}
