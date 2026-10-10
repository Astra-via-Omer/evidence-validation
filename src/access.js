// Only server-controlled Supabase app metadata can grant Evidence access.
export function evidenceAccountAllowed(user) {
  return !!user?.id && !!user.email_confirmed_at && user.is_anonymous !== true &&
    !user.deleted_at && user.app_metadata?.disabled !== true &&
    user.app_metadata?.disabled !== 'true' &&
    !(user.banned_until && Date.parse(user.banned_until) > Date.now()) &&
    user.app_metadata?.system_access?.evidence === true;
}
