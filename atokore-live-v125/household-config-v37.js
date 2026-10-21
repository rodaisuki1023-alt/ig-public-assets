/* Atokore trial: household sharing backend (limited test).
 * null = family sharing is off: no menu entry, no network requests. To start the limited test, set
 * the trial's own Supabase project URL and its public anon key here (never a service/secret key):
 *   window.ATOKORE_HOUSEHOLD_CONFIG = {url: 'https://<project>.supabase.co', anonKey: '<anon key>'};
 * The production app never loads this file. */
window.ATOKORE_HOUSEHOLD_CONFIG = window.ATOKORE_HOUSEHOLD_CONFIG || null;
