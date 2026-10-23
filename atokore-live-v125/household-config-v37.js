/* Atokore trial: Google sign-in to its dedicated family-sharing backend.
 * Only a public publishable key belongs here. Google client secrets stay in Supabase.
 * An explicit pre-load config (including null to disable sharing) is preserved for isolated tests.
 * The production app never loads this file. */
if (!Object.prototype.hasOwnProperty.call(window, 'ATOKORE_HOUSEHOLD_CONFIG')) {
  window.ATOKORE_HOUSEHOLD_CONFIG = {
    url: 'https://vzyxurodowpjltwbgbyc.supabase.co',
    anonKey: 'sb_publishable_26Owk0KT0uV4J0T64QZQyw_wIri_8Ui',
    google: true,
    guest: true,
    email: false
  };
}
