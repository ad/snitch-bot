/**
 * Main Webhook Handler for Anonymous Feedback Bot
 * Handles incoming Telegram webhooks and routes commands
 */

import { validateEnv, getConfig } from './config.js';
import { activateUser, isTrustedUser, revokeAllAccess } from './auth.js';
import { sendMessage, createInlineKeyboard, answerCallbackQuery, sendPhoto, sendVideo, sendDocument, sendMediaGroup, editMessageText, deleteMessage } from './telegram.js';
import { getSession, updateSession, clearSession } from './session.js';
import { formatAdminMessage } from './formatter.js';
import { getRandomPhrase } from './phrases.js';

/**
 * Main Cloudflare Workers fetch handler
 * Processes incoming webhook POST requests from Telegram
 * @param {Request} request - Incoming HTTP request
 * @param {Object} env - Environment bindings (KV, secrets, etc.)
 * @param {Object} ctx - Execution context
 * @returns {Promise<Response>} HTTP response (always 200 for Telegram)
 */
export default {
    async fetch(request, env) {
        try {
            // Only accept POST requests
            if (request.method !== 'POST') {
                return new Response('Method not allowed', { status: 405 });
            }

            // Validate Content-Type
            const contentType = request.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.error('Invalid Content-Type:', contentType);
                return new Response('OK', { status: 200 }); // Return 200 to prevent Telegram retries
            }

            // Validate required environment variables
            const validation = validateEnv(env);
            if (!validation.valid) {
                console.error('Missing required environment variables:', validation.missing);
                return new Response('Configuration error', { status: 500 });
            }

            // Handle REVOKE_ALL_ACCESS if enabled
            const config = getConfig(env);
            if (config.revokeAllAccess) {
                console.log('REVOKE_ALL_ACCESS is enabled, revoking all user access...');
                try {
                    await revokeAllAccess(env);
                } catch (revokeError) {
                    console.error('Error revoking access:', revokeError);
                    // Continue processing even if revoke fails
                }
            }

            // Parse webhook update
            let update;
            try {
                update = await request.json();
            } catch (parseError) {
                console.error('Failed to parse webhook JSON:', parseError);
                return new Response('OK', { status: 200 }); // Return 200 to prevent Telegram retries
            }

            // Process the webhook
            await handleWebhook(update, env);

            // Always return 200 to Telegram to prevent retries
            return new Response('OK', { status: 200 });

        } catch (error) {
            console.error('Critical error in main handler:', error.message, error.stack);
            // Always return 200 to Telegram even on errors to prevent retries
            return new Response('OK', { status: 200 });
        }
    }
};

/**
 * Processes Telegram update object and routes to appropriate handler
 * @param {Object} update - Telegram Update object
 * @param {Object} env - Environment bindings
 * @returns {Promise<void>}
 */
async function handleWebhook(update, env) {
    try {
        // Validate update object
        if (!update || typeof update !== 'object') {
            console.error('Invalid update object received');
            return;
        }

        // Handle regular messages
        if (update.message) {
            const message = update.message;

            try {
                // Check if this is a command
                if (message.text && message.text.startsWith('/')) {
                    await routeCommand(message, env);
                } else {
                    // Handle regular messages (text and media)
                    await handleMessage(message, env);
                }
            } catch (messageError) {
                console.error('Error handling message:', messageError.message, messageError.stack);
                // Try to send error message to user
                try {
                    if (message.chat && message.chat.id) {
                        await sendMessage(
                            message.chat.id,
                            'Произошла ошибка. Пожалуйста, попробуйте позже.',
                            {},
                            env
                        );
                    }
                } catch (sendError) {
                    console.error('Failed to send error message to user:', sendError);
                }
            }
        }

        // Handle callback queries (button clicks)
        if (update.callback_query) {
            try {
                await routeCallbackQuery(update.callback_query, env);
            } catch (callbackError) {
                console.error('Error handling callback query:', callbackError.message, callbackError.stack);
                // Try to answer callback query with error
                try {
                    if (update.callback_query.id) {
                        await answerCallbackQuery(
                            update.callback_query.id,
                            'Произошла ошибка',
                            env
                        );
                    }
                } catch (answerError) {
                    console.error('Failed to answer callback query:', answerError);
                }
            }
        }

    } catch (error) {
        console.error('Critical error in handleWebhook:', error.message, error.stack);
        // Don't throw - we want to return 200 to Telegram
    }
}

/**
 * Routes and handles bot commands
 * @param {Object} message - Telegram Message object
 * @param {Object} env - Environment bindings
 * @returns {Promise<void>}
 */
async function routeCommand(message, env) {
    try {
        const userId = message.from.id.toString();
        const chatId = message.chat.id;
        const text = message.text;

        // Parse command and arguments
        const parts = text.split(' ');
        const command = parts[0];
        const args = parts.slice(1);

        // Handle /start command
        if (command === '/start') {
            // Check if token is provided
            if (args.length > 0) {
                const token = args[0];

                // Attempt to activate user with provided token
                const result = await activateUser(userId, token, env);

                await sendMessage(chatId, result.message, {}, env);

                // If activation was successful, show welcome message and category selection
                if (result.success) {
                    const welcomeMessage =
                        'Добро пожаловать! 👋\n\n' +
                        'Этот бот позволяет отправлять анонимные сообщения руководству.\n\n' +
                        'Выберите категорию вашего сообщения:';

                    // Send category selection keyboard and save message ID
                    const flowMessageId = await sendCategorySelection(chatId, welcomeMessage, env);

                    // Create session with category step and flow message ID
                    await updateSession(userId, { step: 'category', flowMessageId: flowMessageId }, env);
                }
            } else {
                // No token provided - check if user is already trusted
                const trusted = await isTrustedUser(userId, env);

                if (trusted) {
                    // User is already activated, show welcome message and category selection
                    const welcomeMessage =
                        'Добро пожаловать! 👋\n\n' +
                        'Этот бот позволяет отправлять анонимные сообщения руководству.\n\n' +
                        'Выберите категорию вашего сообщения:';

                    // Send category selection keyboard and save message ID
                    const flowMessageId = await sendCategorySelection(chatId, welcomeMessage, env);

                    // Create session with category step and flow message ID
                    await updateSession(userId, { step: 'category', flowMessageId: flowMessageId }, env);
                } else {
                    // Not trusted and no token - send neutral message
                    await sendMessage(chatId, 'Привет! Этот бот пока не активен.', {}, env);
                }
            }
        } else {
            // Unknown command - check if user is trusted
            const trusted = await isTrustedUser(userId, env);

            if (!trusted) {
                // Not trusted - send neutral message
                await sendMessage(chatId, 'Привет! Этот бот пока не активен.', {}, env);
            } else {
                // Trusted user with unknown command
                await sendMessage(
                    chatId,
                    'Неизвестная команда. Просто напишите сообщение, чтобы начать.',
                    {},
                    env
                );
            }
        }

    } catch (error) {
        console.error('Error in routeCommand:', error.message, error.stack);

        // Send user-friendly error message
        try {
            if (message && message.chat && message.chat.id) {
                await sendMessage(
                    message.chat.id,
                    'Произошла ошибка. Пожалуйста, попробуйте позже.',
                    {},
                    env
                );
            }
        } catch (sendError) {
            console.error('Failed to send error message:', sendError.message);
        }
    }
}

/**
 * Routes and handles callback queries (inline button clicks)
 * @param {Object} callbackQuery - Telegram CallbackQuery object
 * @param {Object} env - Environment bindings
 * @returns {Promise<void>}
 */
async function routeCallbackQuery(callbackQuery, env) {
    try {
        const userId = callbackQuery.from.id.toString();
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;

        // Check if user is trusted
        const trusted = await isTrustedUser(userId, env);
        if (!trusted) {
            await answerCallbackQuery(callbackQuery.id, 'Доступ запрещён', env);
            return;
        }

        // Get current session
        const session = await getSession(userId, env);
        if (!session) {
            await answerCallbackQuery(callbackQuery.id, 'Сессия истекла. Начните заново с /start', env);
            return;
        }

        // Handle category selection
        if (data.startsWith('category:')) {
            const category = data.replace('category:', '');
            
            // Map category to display name
            const categoryNames = {
                'idea': '💬 Идея / предложение',
                'problem': '⚠️ Проблема / жалоба',
                'gratitude': '❤️ Благодарность / признание'
            };

            // Update session with selected category and move to topic step
            await updateSession(userId, {
                category: category,
                step: 'topic',
                flowMessageId: callbackQuery.message.message_id
            }, env);

            // Answer callback query
            await answerCallbackQuery(callbackQuery.id, '', env);

            // Edit the message to show selected category and topic selection
            const selectedMessage = `Выбрана категория: ${categoryNames[category] || category}`;
            await sendTopicSelection(chatId, selectedMessage, env, callbackQuery.message.message_id);
            
            return;
        }

        // Handle topic selection
        if (data.startsWith('topic:')) {
            const topic = data.replace('topic:', '');
            
            // Map topic to display name
            const topicNames = {
                'processes': 'Процессы',
                'colleagues': 'Коллеги',
                'conditions': 'Условия',
                'salary': 'Зарплата',
                'management': 'Менеджмент',
                'other': 'Другое'
            };
            
            // Map category to display name
            const categoryNames = {
                'idea': '💬 Идея / предложение',
                'problem': '⚠️ Проблема / жалоба',
                'gratitude': '❤️ Благодарность / признание'
            };

            // Update session with selected topic and move to message step
            await updateSession(userId, {
                topic: topic,
                step: 'message'
            }, env);

            // Answer callback query
            await answerCallbackQuery(callbackQuery.id, '', env);

            // Edit the message to show complete selection
            const categoryName = categoryNames[session.category] || session.category;
            const topicName = topicNames[topic] || topic;
            const finalMessage = 
                `Выбрана категория: ${categoryName}\n` +
                `Выбрана тема: ${topicName}\n\n` +
                `✍️ Отлично! Теперь напишите ваше сообщение.\n\n` +
                `Вы можете отправить текст, фото, видео или документ или все вместе, но в одном сообщении.`;

            await editMessageText(chatId, callbackQuery.message.message_id, finalMessage, {}, env);
            return;
        }

        // Handle confirmation actions (send, rewrite, cancel)
        if (data.startsWith('confirm:')) {
            const action = data.replace('confirm:', '');

            if (action === 'rewrite') {
                // User wants to rewrite the message
                await updateSession(userId, {
                    step: 'message',
                    messageText: null,
                    mediaItems: [],
                    mediaGroupId: null,
                    waitingForMediaGroup: false,
                    sentiment: null
                }, env);

                await answerCallbackQuery(callbackQuery.id, '', env);

                // Edit the message to remove buttons
                const editedMessage = '✏️ Сообщение отменено. Напишите новое сообщение.';
                await editMessageText(chatId, callbackQuery.message.message_id, editedMessage, {}, env);

                return;
            }

            if (action === 'cancel') {
                // User wants to cancel and start over
                await updateSession(userId, {
                    step: 'category',
                    category: null,
                    topic: null,
                    messageText: null,
                    mediaItems: [],
                    mediaGroupId: null,
                    waitingForMediaGroup: false,
                    sentiment: null
                }, env);

                await answerCallbackQuery(callbackQuery.id, '', env);

                // Edit the message to remove buttons
                const editedMessage = '❌ Сообщение отменено.';
                await editMessageText(chatId, callbackQuery.message.message_id, editedMessage, {}, env);

                // Send new category selection and save message ID
                const flowMessageId = await sendCategorySelection(
                    chatId,
                    'Начнём заново. Выберите категорию вашего сообщения:',
                    env
                );
                
                // Update session with new flow message ID
                await updateSession(userId, { flowMessageId: flowMessageId }, env);
                return;
            }

            if (action === 'send') {
                // User confirms sending the message
                await answerCallbackQuery(callbackQuery.id, 'Отправка сообщения...', env);

                // Edit the message to show sending status
                const mediaCount = session.mediaItems ? session.mediaItems.length : 0;
                const mediaText = mediaCount > 0 ? ` (${mediaCount} файл${mediaCount > 1 ? (mediaCount > 4 ? 'ов' : 'а') : ''})` : '';
                const sendingMessage = `📤 Отправка сообщения${mediaText}...`;
                await editMessageText(chatId, callbackQuery.message.message_id, sendingMessage, {}, env);

                // Get fresh session to ensure we have all media items
                const freshSession = await getSession(userId, env);
                if (!freshSession) {
                    await editMessageText(chatId, callbackQuery.message.message_id, '❌ Сессия истекла. Начните заново с /start', {}, env);
                    return;
                }

                // Forward message to admin group
                await forwardMessageToAdmin(userId, chatId, freshSession, env, callbackQuery.message.message_id);
                return;
            }
        }

        // Unknown callback data
        await answerCallbackQuery(callbackQuery.id, 'Неизвестное действие', env);

    } catch (error) {
        console.error('Error in routeCallbackQuery:', error.message, error.stack);

        // Send user-friendly error message
        try {
            if (callbackQuery && callbackQuery.id) {
                await answerCallbackQuery(callbackQuery.id, 'Произошла ошибка', env);
            }
        } catch (answerError) {
            console.error('Failed to answer callback query:', answerError.message);
        }
    }
}

/**
 * Handles regular text and media messages from users
 * @param {Object} message - Telegram Message object
 * @param {Object} env - Environment bindings
 * @returns {Promise<void>}
 */
async function handleMessage(message, env) {
    try {
        const userId = message.from.id.toString();
        const chatId = message.chat.id;

        // Check if user is trusted
        const trusted = await isTrustedUser(userId, env);
        if (!trusted) {
            await sendMessage(chatId, 'Привет! Этот бот пока не активен.', {}, env);
            return;
        }

        // Get current session
        const session = await getSession(userId, env);
        if (!session) {
            await sendMessage(
                chatId,
                'Сессия истекла. Начните заново с /start',
                {},
                env
            );
            return;
        }

        // Get existing session to check for pending media group
        const existingSession = session;

        // Extract text from message
        let messageText = message.text || message.caption || '';

        // Extract media information
        let mediaItems = [];

        if (message.photo && message.photo.length > 0) {
            // Get the largest photo (last in array)
            mediaItems.push({
                type: 'photo',
                fileId: message.photo[message.photo.length - 1].file_id
            });
        } else if (message.video) {
            mediaItems.push({
                type: 'video',
                fileId: message.video.file_id
            });
        } else if (message.document) {
            mediaItems.push({
                type: 'document',
                fileId: message.document.file_id
            });
        }

        // Check if this is part of a media group
        const mediaGroupId = message.media_group_id;

        if (mediaGroupId) {
            // This is part of a media group - collect all messages
            // Allow processing even if step is 'confirm' (for subsequent media group items)
            if (existingSession && existingSession.mediaGroupId === mediaGroupId) {
                // Add this media to the existing collection
                const existingMedia = existingSession.mediaItems || [];
                mediaItems = [...existingMedia, ...mediaItems];

                // Update text if this message has caption and previous didn't
                if (messageText && !existingSession.messageText) {
                    messageText = messageText;
                } else if (existingSession.messageText) {
                    messageText = existingSession.messageText;
                }
            }

            // Store the media group with all collected items
            await updateSession(userId, {
                messageText: messageText,
                mediaItems: mediaItems,
                mediaGroupId: mediaGroupId,
                step: 'message', // Keep step as message so we can process it
                lastMediaTimestamp: Date.now() // Track when last media was received
            }, env);

            console.log('Media group item processed. Total count:', mediaItems.length);

            // For media groups, wait to collect all items before showing confirmation
            // This prevents race conditions and multiple confirmation messages
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Get the latest session after the delay
            const latestSession = await getSession(userId, env);

            // Only process if:
            // 1. This is still the same media group
            // 2. No new media has been added in the last second (meaning collection is complete)
            if (latestSession &&
                latestSession.mediaGroupId === mediaGroupId &&
                Date.now() - latestSession.lastMediaTimestamp >= 1000) {

                console.log('Processing completed media group with', latestSession.mediaItems.length, 'items');

                // Get the confirmMessageId to edit existing message
                const confirmMessageId = latestSession.confirmMessageId || null;

                await processMessageForSentiment(userId, chatId, latestSession, env, confirmMessageId);
            } else {
                console.log('Skipping - more media items are being collected');
            }

            return;
        }

        // Only process non-media-group messages when in 'message' step
        if (session.step !== 'message') {
            await sendMessage(
                chatId,
                'Пожалуйста, следуйте инструкциям. Используйте /start для начала.',
                {},
                env
            );
            return;
        }

        // Validate that we have at least text or media
        if (!messageText && mediaItems.length === 0) {
            await sendMessage(
                chatId,
                'Пожалуйста, отправьте текстовое сообщение или медиафайл.',
                {},
                env
            );
            return;
        }

        // Store message text and media in session
        const updatedSession = await updateSession(userId, {
            messageText: messageText,
            mediaItems: mediaItems,
            mediaGroupId: null,
            waitingForMediaGroup: false
        }, env);

        // Process the message for sentiment analysis and confirmation
        await processMessageForSentiment(userId, chatId, updatedSession, env);

    } catch (error) {
        console.error('Error in handleMessage:', error.message, error.stack);

        // Send user-friendly error message
        try {
            if (message && message.chat && message.chat.id) {
                await sendMessage(
                    message.chat.id,
                    'Произошла ошибка. Пожалуйста, попробуйте позже.',
                    {},
                    env
                );
            }
        } catch (sendError) {
            console.error('Failed to send error message:', sendError.message);
        }
    }
}

/**
 * Processes message for sentiment analysis and shows confirmation
 * @param {string} userId - User ID
 * @param {number|string} chatId - User's chat ID
 * @param {Object} session - User's session object
 * @param {Object} env - Environment bindings
 * @param {string|null} messageId - Message ID to edit (for media groups)
 * @returns {Promise<void>}
 */
async function processMessageForSentiment(userId, chatId, session, env, messageId = null) {
    try {
        const messageText = session.messageText;

        // Proceed directly to confirmation (no sentiment analysis)
        const mediaCount = session.mediaItems ? session.mediaItems.length : 0;
        const mediaText = mediaCount > 0 ? ` (${mediaCount} файл${mediaCount > 1 ? 'а' : ''})` : '';

        const confirmMessage =
            `✅ Ваше сообщение готово к отправке${mediaText}.\n\n` +
            'Нажмите "Отправить" для подтверждения или "Отменить" для начала заново.';

        const keyboard = createInlineKeyboard([
            [{ text: 'Отправить', callback_data: 'confirm:send' }],
            [{ text: 'Отменить', callback_data: 'confirm:cancel' }]
        ]);

        // If we have a messageId (from previous confirmation), edit it instead of sending new
        if (messageId) {
                console.log('Editing existing confirmation message:', messageId);
                try {
                    const editResult = await editMessageText(chatId, messageId, confirmMessage, { reply_markup: keyboard }, env);
                    console.log('Edit result:', editResult.success);
                } catch (editError) {
                    console.error('Error editing message:', editError.message);
                    // If edit fails, send new message
                    const result = await sendMessage(chatId, confirmMessage, { reply_markup: keyboard }, env);

                    // Store the new message ID
                    if (result.success && result.data && result.data.message_id) {
                        try {
                            await updateSession(userId, {
                                confirmMessageId: result.data.message_id
                            }, env);
                        } catch (sessionError) {
                            console.error('Error storing confirmation message ID:', sessionError.message);
                        }
                    }
            }
        } else {
            console.log('Sending new confirmation message');
            const result = await sendMessage(chatId, confirmMessage, { reply_markup: keyboard }, env);

            // Store the message ID for potential future edits
            if (result.success && result.data && result.data.message_id) {
                console.log('Storing confirmation message ID:', result.data.message_id);
                try {
                    await updateSession(userId, {
                        confirmMessageId: result.data.message_id
                    }, env);
                } catch (sessionError) {
                    console.error('Error storing confirmation message ID:', sessionError.message);
                }
            }
        }

        // Update session step to confirm
        try {
            await updateSession(userId, {
                step: 'confirm'
            }, env);
        } catch (sessionError) {
            console.error('Error updating session step:', sessionError.message);
            // Continue processing
        }
    } catch (error) {
        console.error('Error in processMessageForSentiment:', error.message, error.stack);
        throw error; // Re-throw to be handled by caller
    }
}

/**
 * Forwards user's message to the admin group
 * @param {string} userId - User ID
 * @param {number|string} chatId - User's chat ID
 * @param {Object} session - User's session object
 * @param {Object} env - Environment bindings
 * @param {number} confirmMessageId - Message ID to edit after sending (optional)
 * @returns {Promise<void>}
 */
async function forwardMessageToAdmin(userId, chatId, session, env, confirmMessageId = null) {
    try {
        const config = getConfig(env);

        // Determine which admin chat ID to use based on TEST_MODE
        const adminChatId = config.testMode && config.adminChatIdTest
            ? config.adminChatIdTest
            : config.adminChatId;

        // Format the message using formatAdminMessage
        const formattedMessage = formatAdminMessage(session);

        // Send the message to admin group
        let sendResult;

        const mediaItems = session.mediaItems || [];

        // Log media items for debugging
        console.log('Forwarding message with media items:', JSON.stringify({
            count: mediaItems.length,
            items: mediaItems
        }));

        if (mediaItems.length > 1) {
            // Multiple media files - use sendMediaGroup
            // Add caption to the first media item
            const mediaGroup = mediaItems.map((item, index) => ({
                type: item.type,
                media: item.fileId,
                // Add formatted message as caption to first item
                caption: index === 0 ? formattedMessage : undefined
            }));

            sendResult = await sendMediaGroup(adminChatId, mediaGroup, env);

        } else if (mediaItems.length === 1) {
            // Single media file - send with formatted message as caption
            const media = mediaItems[0];

            if (media.type === 'photo') {
                sendResult = await sendPhoto(adminChatId, media.fileId, formattedMessage, {}, env);
            } else if (media.type === 'video') {
                sendResult = await sendVideo(adminChatId, media.fileId, formattedMessage, {}, env);
            } else if (media.type === 'document') {
                sendResult = await sendDocument(adminChatId, media.fileId, formattedMessage, {}, env);
            }

        } else {
            // No media, just send the formatted text message
            sendResult = await sendMessage(adminChatId, formattedMessage, {}, env);
        }

        // Check if message was sent successfully
        if (!sendResult.success) {
            throw new Error(`Failed to send message to admin: ${sendResult.error}`);
        }

        // Message sent successfully
        const inspirationalPhrase = getRandomPhrase();
        
        // If we have a confirmMessageId, edit it to show success
        if (confirmMessageId) {
            const successMessage = `✅ Сообщение отправлено!\n\n${inspirationalPhrase}`;
            await editMessageText(chatId, confirmMessageId, successMessage, {}, env);
        } else {
            // Otherwise send a new message
            await sendMessage(chatId, inspirationalPhrase, {}, env);
        }

        // Log message to KV if TEST_MODE is enabled
        if (config.testMode) {
            try {
                const timestamp = Date.now();
                const logKey = `test_log:${timestamp}`;
                const logData = {
                    timestamp: timestamp,
                    userId: userId,
                    category: session.category,
                    topic: session.topic,
                    messageText: session.messageText,
                    mediaItems: session.mediaItems,
                    sentiment: session.sentiment,
                    adminChatId: adminChatId
                };

                // Store log with 30 day TTL
                await env.KV.put(logKey, JSON.stringify(logData), {
                    expirationTtl: 2592000 // 30 days in seconds
                });

                console.log('Message logged to KV:', logKey);
            } catch (logError) {
                console.error('Error logging message to KV:', logError);
                // Non-critical error, continue processing
            }
        }

        // Clear the session after successful message delivery
        await clearSession(userId, env);

    } catch (error) {
        console.error('Error forwarding message to admin:', error.message, error.stack);

        // Send error message to user
        try {
            const errorMessage = 'Произошла ошибка при отправке сообщения. Пожалуйста, попробуйте позже.';
            
            if (confirmMessageId) {
                await editMessageText(chatId, confirmMessageId, `❌ ${errorMessage}`, {}, env);
            } else {
                await sendMessage(
                    chatId,
                    errorMessage,
                    {},
                    env
                );
            }
        } catch (sendError) {
            console.error('Failed to send error message to user:', sendError.message);
        }
    }
}

/**
 * Sends or updates category selection keyboard
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} text - Message text to send with keyboard
 * @param {Object} env - Environment bindings
 * @param {number} messageId - Message ID to edit (optional)
 * @returns {Promise<number>} Message ID
 */
async function sendCategorySelection(chatId, text, env, messageId = null) {
    const keyboard = createInlineKeyboard([
        [{ text: '💬 Идея / предложение', callback_data: 'category:idea' }],
        [{ text: '⚠️ Проблема / жалоба', callback_data: 'category:problem' }],
        [{ text: '❤️ Благодарность / признание', callback_data: 'category:gratitude' }]
    ]);

    if (messageId) {
        await editMessageText(chatId, messageId, text, { reply_markup: keyboard }, env);
        return messageId;
    } else {
        const result = await sendMessage(chatId, text, { reply_markup: keyboard }, env);
        return result.data?.message_id;
    }
}

/**
 * Sends or updates topic selection keyboard
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} previousText - Previous message text to prepend
 * @param {Object} env - Environment bindings
 * @param {number} messageId - Message ID to edit (optional)
 * @returns {Promise<number>} Message ID
 */
async function sendTopicSelection(chatId, previousText, env, messageId = null) {
    const text = previousText + '\n\nВыберите тему вашего сообщения:';

    const keyboard = createInlineKeyboard([
        [{ text: 'Процессы', callback_data: 'topic:processes' }],
        [{ text: 'Коллеги', callback_data: 'topic:colleagues' }],
        [{ text: 'Условия', callback_data: 'topic:conditions' }],
        [{ text: 'Зарплата', callback_data: 'topic:salary' }],
        [{ text: 'Менеджмент', callback_data: 'topic:management' }],
        [{ text: 'Другое', callback_data: 'topic:other' }]
    ]);

    if (messageId) {
        await editMessageText(chatId, messageId, text, { reply_markup: keyboard }, env);
        return messageId;
    } else {
        const result = await sendMessage(chatId, text, { reply_markup: keyboard }, env);
        return result.data?.message_id;
    }
}
