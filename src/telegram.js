/**
 * Telegram API Integration Module
 * Handles all interactions with Telegram Bot API including message sending,
 * media forwarding, and retry logic with exponential backoff.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Creates inline keyboard markup for Telegram messages
 * @param {Array<Array<{text: string, callback_data: string}>>} buttons - 2D array of button objects
 * @returns {Object} Inline keyboard markup object
 */
export function createInlineKeyboard(buttons) {
    return {
        inline_keyboard: buttons
    };
}

/**
 * Makes a request to Telegram Bot API with retry logic and exponential backoff
 * @param {string} method - Telegram API method name (e.g., 'sendMessage')
 * @param {Object} params - Parameters for the API method
 * @param {Object} env - Environment bindings (contains TELEGRAM_TOKEN)
 * @param {number} retries - Number of retry attempts (default: 3)
 * @returns {Promise<Object>} API response object
 */
export async function apiRequest(method, params, env, retries = 3) {
    if (!method || !env || !env.TELEGRAM_TOKEN) {
        throw new Error('Invalid parameters for apiRequest');
    }

    const url = `${TELEGRAM_API_BASE}${env.TELEGRAM_TOKEN}/${method}`;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(params),
            });

            let data;
            try {
                data = await response.json();
            } catch (parseError) {
                console.error('Failed to parse Telegram API response:', parseError.message);
                throw new Error('Invalid JSON response from Telegram API');
            }

            if (!response.ok) {
                // Handle rate limiting with Retry-After header
                if (response.status === 429 && data.parameters?.retry_after) {
                    const retryAfter = data.parameters.retry_after * 1000;
                    console.warn(`Rate limited. Retrying after ${retryAfter}ms`);
                    await sleep(retryAfter);
                    continue;
                }

                // Log specific error codes
                if (response.status === 401) {
                    console.error('Telegram API authentication failed - invalid token');
                } else if (response.status === 400) {
                    console.error('Telegram API bad request:', data.description);
                }

                throw new Error(`Telegram API error (${response.status}): ${data.description || response.statusText}`);
            }

            return data;
        } catch (error) {
            console.error(`Telegram API request failed (attempt ${attempt + 1}/${retries}):`, error.message);

            // If this was the last attempt, throw the error
            if (attempt === retries - 1) {
                throw error;
            }

            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`Retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error('All retry attempts exhausted');
}

/**
 * Helper function to sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sends a text message to a Telegram chat
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} text - Message text
 * @param {Object} options - Additional options (reply_markup, parse_mode, etc.)
 * @param {Object} env - Environment bindings
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendMessage(chatId, text, options = {}, env) {
    try {
        if (!chatId || !text) {
            throw new Error('chatId and text are required');
        }

        const params = {
            chat_id: chatId,
            text: text,
            ...options,
        };

        const response = await apiRequest('sendMessage', params, env);

        return {
            success: response.ok,
            messageId: response.result?.message_id,
        };
    } catch (error) {
        console.error('Failed to send message:', error.message, error.stack);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Sends a photo to a Telegram chat
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} photoFileId - Telegram file_id of the photo
 * @param {string} caption - Photo caption (optional)
 * @param {Object} options - Additional options
 * @param {Object} env - Environment bindings
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendPhoto(chatId, photoFileId, caption = '', options = {}, env) {
    try {
        if (!chatId || !photoFileId) {
            throw new Error('chatId and photoFileId are required');
        }

        const params = {
            chat_id: chatId,
            photo: photoFileId,
            ...options,
        };

        if (caption) {
            params.caption = caption;
        }

        const response = await apiRequest('sendPhoto', params, env);

        return {
            success: response.ok,
            messageId: response.result?.message_id,
        };
    } catch (error) {
        console.error('Failed to send photo:', error.message, error.stack);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Sends a video to a Telegram chat
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} videoFileId - Telegram file_id of the video
 * @param {string} caption - Video caption (optional)
 * @param {Object} options - Additional options
 * @param {Object} env - Environment bindings
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendVideo(chatId, videoFileId, caption = '', options = {}, env) {
    try {
        if (!chatId || !videoFileId) {
            throw new Error('chatId and videoFileId are required');
        }

        const params = {
            chat_id: chatId,
            video: videoFileId,
            ...options,
        };

        if (caption) {
            params.caption = caption;
        }

        const response = await apiRequest('sendVideo', params, env);

        return {
            success: response.ok,
            messageId: response.result?.message_id,
        };
    } catch (error) {
        console.error('Failed to send video:', error.message, error.stack);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Sends a document to a Telegram chat
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} documentFileId - Telegram file_id of the document
 * @param {string} caption - Document caption (optional)
 * @param {Object} options - Additional options
 * @param {Object} env - Environment bindings
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendDocument(chatId, documentFileId, caption = '', options = {}, env) {
    try {
        if (!chatId || !documentFileId) {
            throw new Error('chatId and documentFileId are required');
        }

        const params = {
            chat_id: chatId,
            document: documentFileId,
            ...options,
        };

        if (caption) {
            params.caption = caption;
        }

        const response = await apiRequest('sendDocument', params, env);

        return {
            success: response.ok,
            messageId: response.result?.message_id,
        };
    } catch (error) {
        console.error('Failed to send document:', error.message, error.stack);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Sends a media group (multiple photos/videos in one message)
 * @param {number|string} chatId - Telegram chat ID
 * @param {Array<Object>} media - Array of media objects with type and file_id
 * @param {Object} env - Environment bindings
 * @returns {Promise<{success: boolean, messageIds?: Array<number>, error?: string}>}
 */
export async function sendMediaGroup(chatId, media, env) {
    try {
        if (!chatId || !media || !Array.isArray(media) || media.length === 0) {
            throw new Error('chatId and non-empty media array are required');
        }

        const params = {
            chat_id: chatId,
            media: media,
        };

        const response = await apiRequest('sendMediaGroup', params, env);

        return {
            success: response.ok,
            messageIds: response.result?.map(msg => msg.message_id),
        };
    } catch (error) {
        console.error('Failed to send media group:', error.message, error.stack);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Answers a callback query (responds to inline button clicks)
 * @param {string} callbackQueryId - Callback query ID from Telegram
 * @param {string} text - Text to show in notification (optional)
 * @param {Object} env - Environment bindings
 * @returns {Promise<{success: boolean}>}
 */
export async function answerCallbackQuery(callbackQueryId, text = '', env) {
    try {
        if (!callbackQueryId) {
            throw new Error('callbackQueryId is required');
        }

        const params = {
            callback_query_id: callbackQueryId,
        };

        if (text) {
            params.text = text;
        }

        const response = await apiRequest('answerCallbackQuery', params, env);

        return {
            success: response.ok,
        };
    } catch (error) {
        console.error('Failed to answer callback query:', error.message, error.stack);
        return {
            success: false,
        };
    }
}
