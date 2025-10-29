/**
 * Configuration and validation module for the anonymous feedback bot
 * Handles environment variable validation and provides typed configuration access
 */

/**
 * Validates that all required environment variables are present
 * @param {Object} env - Environment bindings from Cloudflare Workers
 * @returns {{ valid: boolean, missing: string[] }} - Validation result with list of missing variables
 */
export function validateEnv(env) {
  const required = ['TELEGRAM_TOKEN', 'ADMIN_CHAT_ID', 'ACCESS_TOKEN'];
  const missing = [];

  for (const key of required) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Returns a typed configuration object with all environment variables
 * @param {Object} env - Environment bindings from Cloudflare Workers
 * @returns {Object} - Configuration object
 */
export function getConfig(env) {
  // Required fields
  const telegramToken = env.TELEGRAM_TOKEN;
  const adminChatId = env.ADMIN_CHAT_ID;
  const accessToken = env.ACCESS_TOKEN;

  // Optional fields for testing and access control
  const testMode = env.TEST_MODE === 'true' || env.TEST_MODE === true;
  const adminChatIdTest = env.ADMIN_CHAT_ID_TEST || null;
  const revokeAllAccess = env.REVOKE_ALL_ACCESS === 'true' || env.REVOKE_ALL_ACCESS === true;

  return {
    telegramToken,
    adminChatId,
    accessToken,
    testMode,
    adminChatIdTest,
    revokeAllAccess
  };
}
