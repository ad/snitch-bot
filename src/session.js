/**
 * Session State Management Module
 * Manages user conversation state in KV storage
 */

const SESSION_TTL = 3600; // 1 hour in seconds

/**
 * Session schema definition
 * @typedef {Object} Session
 * @property {string} step - Current step: 'category' | 'topic' | 'message' | 'sentiment_review' | 'confirm'
 * @property {string|null} category - Selected message category
 * @property {string|null} topic - Selected message topic
 * @property {string|null} messageText - User's message text
 * @property {Array<{type: string, fileId: string}>} mediaItems - Array of media items (supports multiple files)
 * @property {string|null} mediaGroupId - Telegram media_group_id for grouping multiple media
 * @property {boolean} waitingForMediaGroup - Flag indicating if we're collecting media group messages
 * @property {string|null} sentiment - Sentiment analysis result: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | null
 * @property {number} createdAt - Timestamp when session was created
 */

/**
 * Generates KV key for user session
 * @param {string} userId - Telegram user ID
 * @returns {string} KV key
 */
function getSessionKey(userId) {
  return `session:${userId}`;
}

/**
 * Retrieves user session from KV storage
 * @param {string} userId - Telegram user ID
 * @param {Object} env - Environment bindings with KV namespace
 * @returns {Promise<Session|null>} Session object or null if not found
 */
export async function getSession(userId, env) {
  try {
    if (!userId || !env || !env.KV) {
      console.error('Invalid parameters for getSession');
      return null;
    }

    const key = getSessionKey(userId);
    const sessionData = await env.KV.get(key, { type: 'json' });
    return sessionData;
  } catch (error) {
    console.error('Error getting session from KV:', error.message, error.stack);
    // Return null on KV failure to allow graceful degradation
    return null;
  }
}

/**
 * Updates user session with new data
 * @param {string} userId - Telegram user ID
 * @param {Partial<Session>} updates - Fields to update in session
 * @param {Object} env - Environment bindings with KV namespace
 * @returns {Promise<Session>} Updated session object
 */
export async function updateSession(userId, updates, env) {
  try {
    if (!userId || !env || !env.KV) {
      throw new Error('Invalid parameters for updateSession');
    }

    if (!updates || typeof updates !== 'object') {
      throw new Error('Invalid updates object');
    }

    const key = getSessionKey(userId);
    
    // Get existing session or create new one
    let session = await getSession(userId, env);
    
    if (!session) {
      // Create new session with defaults
      session = {
        step: 'category',
        category: null,
        topic: null,
        messageText: null,
        mediaItems: [],
        mediaGroupId: null,
        waitingForMediaGroup: false,
        sentiment: null,
        createdAt: Date.now()
      };
    }
    
    // Merge updates into session
    session = { ...session, ...updates };
    
    // Store updated session with TTL
    try {
      await env.KV.put(key, JSON.stringify(session), {
        expirationTtl: SESSION_TTL
      });
    } catch (kvError) {
      console.error('KV storage failure in updateSession:', kvError.message);
      throw new Error('Failed to store session in KV');
    }
    
    return session;
  } catch (error) {
    console.error('Error updating session:', error.message, error.stack);
    throw error;
  }
}

/**
 * Clears user session from KV storage
 * @param {string} userId - Telegram user ID
 * @param {Object} env - Environment bindings with KV namespace
 * @returns {Promise<void>}
 */
export async function clearSession(userId, env) {
  try {
    if (!userId || !env || !env.KV) {
      console.error('Invalid parameters for clearSession');
      return;
    }

    const key = getSessionKey(userId);
    await env.KV.delete(key);
  } catch (error) {
    console.error('Error clearing session from KV:', error.message, error.stack);
    // Non-critical error, don't throw - continue processing
  }
}
