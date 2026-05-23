import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminUserInviteSchema } from '@/lib/validations';

/**
 * POST /api/admin/users/invite — пригласить пользователя по email (только admin).
 * Профиль создаётся триггером handle_new_user из user_metadata (full_name, role).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const body: unknown = await request.json();
    const parsed = adminUserInviteSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { email, full_name, role } = parsed.data;

    const db = createAdminClient();
    const { error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role },
    });

    if (error) {
      // Supabase возвращает 422/email_exists при дубле.
      if (/exist|registered|already/i.test(error.message)) {
        return apiError('EMAIL_ALREADY_EXISTS', 'Пользователь с таким email уже зарегистрирован', 409);
      }
      return apiError('INVITE_FAILED', error.message, 502);
    }

    return apiSuccess({ message: `Приглашение отправлено на ${email}` });
  } catch (err) {
    return handleApiError(err);
  }
}
