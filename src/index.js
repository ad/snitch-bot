/**
 * Main Webhook Handler for Anonymous Feedback Bot
 * Handles incoming Telegram webhooks and routes commands
 */

import { validateEnv, getConfig } from './config.js';
import { activateUser, isTrustedUser, revokeAllAccess } from './auth.js';
import { sendMessage, createInlineKeyboard, answerCallbackQuery, sendPhoto, sendVideo, sendDocument, sendMediaGroup } from './telegram.js';
import { getSession, updateSession, clearSession } from './session.js';
import { analyzeSentiment, isAIEnabled } from './ai.js';
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

                    // Create session with category step
                    await updateSession(userId, { step: 'category' }, env);

                    // Send category selection keyboard
                    await sendCategorySelection(chatId, welcomeMessage, env);
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

                    // Create session with category step
                    await updateSession(userId, { step: 'category' }, env);

                    // Send category selection keyboard
                    await sendCategorySelection(chatId, welcomeMessage, env);
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

            // Update session with selected category and move to topic step
            await updateSession(userId, {
                category: category,
                step: 'topic'
            }, env);

            // Answer callback query
            await answerCallbackQuery(callbackQuery.id, '', env);

            // Send topic selection keyboard
            await sendTopicSelection(chatId, env);
            return;
        }

        // Handle topic selection
        if (data.startsWith('topic:')) {
            const topic = data.replace('topic:', '');

            // Update session with selected topic and move to message step
            await updateSession(userId, {
                topic: topic,
                step: 'message'
            }, env);

            // Answer callback query
            await answerCallbackQuery(callbackQuery.id, '', env);

            // Send prompt asking user to write their message
            const promptMessage =
                'Отлично! Теперь напишите ваше сообщение.\n\n' +
                'Вы можете отправить текст, фото, видео или документ или все вместе, но в одном сообщении.';

            await sendMessage(chatId, promptMessage, {}, env);
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

                const promptMessage =
                    'Хорошо, напишите новое сообщение.\n\n' +
                    'Вы можете отправить текст, фото, видео или документ.';

                await sendMessage(chatId, promptMessage, {}, env);
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

                await sendCategorySelection(
                    chatId,
                    'Начнём заново. Выберите категорию вашего сообщения:',
                    env
                );
                return;
            }

            if (action === 'send') {
                // User confirms sending the message
                await answerCallbackQuery(callbackQuery.id, 'Отправка сообщения...', env);

                // Forward message to admin group
                await forwardMessageToAdmin(userId, chatId, session, env);
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

        // Only process messages when in 'message' step
        if (session.step !== 'message') {
            await sendMessage(
                chatId,
                'Пожалуйста, следуйте инструкциям. Используйте /start для начала.',
                {},
                env
            );
            return;
        }

        // Get existing session to check for pending media group
        const existingSession = await getSession(userId, env);

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
            if (existingSession && existingSession.mediaGroupId === mediaGroupId) {
                // Add this media to the existing collection
                const existingMedia = existingSession.mediaItems || [];
                mediaItems = [...existingMedia, ...mediaItems];

                // Update text if this message has caption and previous didn't
                if (messageText && !existingSession.messageText) {
                    // Use this caption
                } else if (existingSession.messageText) {
                    // Keep existing text
                    messageText = existingSession.messageText;
                }
            }

            // Store the media group and continue collecting
            await updateSession(userId, {
                messageText: messageText,
                mediaItems: mediaItems,
                mediaGroupId: mediaGroupId,
                waitingForMediaGroup: true
            }, env);

            // Don't process yet - wait for all media group messages
            return;
        }

        // If we had a pending media group and now got a non-group message,
        // process the previous media group first
        if (existingSession && existingSession.waitingForMediaGroup && existingSession.mediaItems && existingSession.mediaItems.length > 0) {
            // Process the previous media group
            await processMessageForSentiment(userId, chatId, existingSession, env);

            // Now handle the current message as a new message
            // Reset session for new message
            await updateSession(userId, {
                step: 'message',
                messageText: null,
                mediaItems: [],
                mediaGroupId: null,
                waitingForMediaGroup: false,
                sentiment: null
            }, env);

            // Ask user to send message again
            await sendMessage(
                chatId,
                'Предыдущее сообщение обработано. Пожалуйста, отправьте новое сообщение.',
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
 * @returns {Promise<void>}
 */
async function processMessageForSentiment(userId, chatId, session, env) {
    try {
        const messageText = session.messageText;

        // Analyze sentiment if AI is enabled and we have text
        let sentiment = null;
        if (messageText && isAIEnabled(env)) {
            try {
                const sentimentResult = await analyzeSentiment(messageText, env);
                if (sentimentResult) {
                    sentiment = sentimentResult.sentiment;

                    // Store sentiment in session
                    try {
                        await updateSession(userId, {
                            sentiment: sentiment
                        }, env);
                    } catch (sessionError) {
                        console.error('Error storing sentiment in session:', sessionError.message);
                        // Continue processing even if session update fails
                    }
                }
            } catch (aiError) {
                console.error('Error analyzing sentiment:', aiError.message);
                // Continue without sentiment analysis (graceful degradation)
            }
        }

        // If sentiment is NEGATIVE, show options to send or rewrite
        if (sentiment === 'NEGATIVE') {
            const warningMessage =
                '⚠️ Обратите внимание: ваше сообщение содержит негативную тональность.\n\n' +
                'Вы можете:\n' +
                '• Отправить сообщение как есть\n' +
                '• Изменить формулировку';

            const keyboard = createInlineKeyboard([
                [{ text: 'Отправить', callback_data: 'confirm:send' }],
                [{ text: 'Изменить', callback_data: 'confirm:rewrite' }]
            ]);

            await sendMessage(chatId, warningMessage, { reply_markup: keyboard }, env);

            // Update session step to sentiment_review
            try {
                await updateSession(userId, {
                    step: 'sentiment_review'
                }, env);
            } catch (sessionError) {
                console.error('Error updating session step:', sessionError.message);
                // Continue processing
            }
        } else {
            // If sentiment is POSITIVE/NEUTRAL or AI disabled, proceed to confirmation
            const mediaCount = session.mediaItems ? session.mediaItems.length : 0;
            const mediaText = mediaCount > 0 ? ` (${mediaCount} файл${mediaCount > 1 ? 'а' : ''})` : '';

            const confirmMessage =
                `✅ Ваше сообщение готово к отправке${mediaText}.\n\n` +
                'Нажмите "Отправить" для подтверждения или "Отменить" для начала заново.';

            const keyboard = createInlineKeyboard([
                [{ text: 'Отправить', callback_data: 'confirm:send' }],
                [{ text: 'Отменить', callback_data: 'confirm:cancel' }]
            ]);

            await sendMessage(chatId, confirmMessage, { reply_markup: keyboard }, env);

            // Update session step to confirm
            try {
                await updateSession(userId, {
                    step: 'confirm'
                }, env);
            } catch (sessionError) {
                console.error('Error updating session step:', sessionError.message);
                // Continue processing
            }
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
 * @returns {Promise<void>}
 */
async function forwardMessageToAdmin(userId, chatId, session, env) {
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

        if (mediaItems.length > 1) {
            // Multiple media files - use sendMediaGroup
            // First, send the formatted text message
            await sendMessage(adminChatId, formattedMessage, {}, env);

            // Then send the media group
            const mediaGroup = mediaItems.map((item, index) => ({
                type: item.type,
                media: item.fileId,
                // Only add caption to first item if there's no separate text
                caption: index === 0 && !session.messageText ? formattedMessage : undefined
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

        // Message sent successfully - send inspirational phrase to user
        const inspirationalPhrase = getRandomPhrase();
        await sendMessage(
            chatId,
            inspirationalPhrase,
            {},
            env
        );

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
            await sendMessage(
                chatId,
                'Произошла ошибка при отправке сообщения. Пожалуйста, попробуйте позже.',
                {},
                env
            );
        } catch (sendError) {
            console.error('Failed to send error message to user:', sendError.message);
        }
    }
}

/**
 * Sends category selection keyboard to user
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} text - Message text to send with keyboard
 * @param {Object} env - Environment bindings
 * @returns {Promise<void>}
 */
async function sendCategorySelection(chatId, text, env) {
    const keyboard = createInlineKeyboard([
        [{ text: '💬 Идея / предложение', callback_data: 'category:idea' }],
        [{ text: '⚠️ Проблема / жалоба', callback_data: 'category:problem' }],
        [{ text: '❤️ Благодарность / признание', callback_data: 'category:gratitude' }]
    ]);

    await sendMessage(chatId, text, { reply_markup: keyboard }, env);
}

/**
 * Sends topic selection keyboard to user
 * @param {number|string} chatId - Telegram chat ID
 * @param {Object} env - Environment bindings
 * @returns {Promise<void>}
 */
async function sendTopicSelection(chatId, env) {
    const text = 'Выберите тему вашего сообщения:';

    const keyboard = createInlineKeyboard([
        [{ text: 'Процессы', callback_data: 'topic:processes' }],
        [{ text: 'Коллеги', callback_data: 'topic:colleagues' }],
        [{ text: 'Условия', callback_data: 'topic:conditions' }],
        [{ text: 'Зарплата', callback_data: 'topic:salary' }],
        [{ text: 'Менеджмент', callback_data: 'topic:management' }],
        [{ text: 'Другое', callback_data: 'topic:other' }]
    ]);

    await sendMessage(chatId, text, { reply_markup: keyboard }, env);
}
