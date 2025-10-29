/**
 * Authentication Module
 * Handles user activation, trust verification, and access revocation
 */

const TRUSTED_USER_TTL = 7776000; // 90 days in seconds
const TRUSTED_KEY_PREFIX = 'trusted:';

/**
 * Activates a user if the provided token matches ACCESS_TOKEN
 * @param {string} userId - Telegram user ID
 * @param {string} token - Token provided by user
 * @param {Object} env - Environment bindings
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function activateUser(userId, token, env) {
  try {
    if (!userId || !token || !env) {
      console.error('Invalid parameters for activateUser');
      return {
        success: false,
        message: 'Произошла ошибка. Пожалуйста, попробуйте позже.'
      };
    }

    const { accessToken } = await import('./config.js').then(m => m.getConfig(env));
    
    if (token !== accessToken) {
      return {
        success: false,
        message: 'Привет! Этот бот пока не активен.'
      };
    }

    // Store trusted user in KV with 90-day TTL
    const key = `${TRUSTED_KEY_PREFIX}${userId}`;
    const value = {
      activatedAt: Date.now(),
      expiresAt: Date.now() + (TRUSTED_USER_TTL * 1000)
    };

    try {
      await env.KV.put(key, JSON.stringify(value), {
        expirationTtl: TRUSTED_USER_TTL
      });
    } catch (kvError) {
      console.error('KV storage failure in activateUser:', kvError.message);
      return {
        success: false,
        message: 'Произошла ошибка. Пожалуйста, попробуйте позже.'
      };
    }

    return {
      success: true,
      message: 'Активация прошла успешно! Теперь вы можете отправлять анонимные сообщения.'
    };
  } catch (error) {
    console.error('Error in activateUser:', error.message, error.stack);
    return {
      success: false,
      message: 'Произошла ошибка. Пожалуйста, попробуйте позже.'
    };
  }
}

/**
 * Checks if a user is trusted (has been activated)
 * @param {string} userId - Telegram user ID
 * @param {Object} env - Environment bindings
 * @returns {Promise<boolean>}
 */
export async function isTrustedUser(userId, env) {
  try {
    if (!userId || !env || !env.KV) {
      console.error('Invalid parameters for isTrustedUser');
      return false;
    }

    const key = `${TRUSTED_KEY_PREFIX}${userId}`;
    const value = await env.KV.get(key);
    
    return value !== null;
  } catch (error) {
    console.error('Error in isTrustedUser:', error.message, error.stack);
    // On KV error, default to not trusted for security
    return false;
  }
}

/**
 * Revokes access for all trusted users by clearing all trusted entries
 * Used when REVOKE_ALL_ACCESS environment variable is true
 * @param {Object} env - Environment bindings
 * @returns {Promise<{revokedCount: number}>}
 */
export async function revokeAllAccess(env) {
  try {
    if (!env || !env.KV) {
      console.error('Invalid environment for revokeAllAccess');
      return { revokedCount: 0 };
    }

    let revokedCount = 0;
    
    // List all keys with the trusted prefix
    const listResult = await env.KV.list({ prefix: TRUSTED_KEY_PREFIX });
    
    // Delete each trusted user entry
    for (const key of listResult.keys) {
      try {
        await env.KV.delete(key.name);
        revokedCount++;
      } catch (deleteError) {
        console.error(`Failed to delete key ${key.name}:`, deleteError.message);
        // Continue with other keys
      }
    }
    
    // Handle pagination if there are more keys
    let cursor = listResult.cursor;
    while (!listResult.list_complete && cursor) {
      try {
        const nextResult = await env.KV.list({ 
          prefix: TRUSTED_KEY_PREFIX,
          cursor: cursor
        });
        
        for (const key of nextResult.keys) {
          try {
            await env.KV.delete(key.name);
            revokedCount++;
          } catch (deleteError) {
            console.error(`Failed to delete key ${key.name}:`, deleteError.message);
            // Continue with other keys
          }
        }
        
        cursor = nextResult.cursor;
      } catch (listError) {
        console.error('Error listing next page of keys:', listError.message);
        break; // Stop pagination on error
      }
    }
    
    console.log(`Revoked access for ${revokedCount} users`);
    
    return { revokedCount };
  } catch (error) {
    console.error('Error in revokeAllAccess:', error.message, error.stack);
    return { revokedCount: 0 };
  }
}
