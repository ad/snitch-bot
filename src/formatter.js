/**
 * Message Formatter Module
 * Formats anonymous feedback messages for the admin group
 */

/**
 * Maps category keys to their full Russian names
 */
const CATEGORY_NAMES = {
  'idea': 'Идея / предложение',
  'problem': 'Проблема / жалоба',
  'gratitude': 'Благодарность / признание'
};

/**
 * Maps category keys to their corresponding emojis
 */
const CATEGORY_EMOJIS = {
  'idea': '💬',
  'problem': '⚠️',
  'gratitude': '❤️'
};

/**
 * Maps topic keys to their full Russian names
 */
const TOPIC_NAMES = {
  'processes': 'Процессы',
  'colleagues': 'Коллеги',
  'conditions': 'Условия',
  'salary': 'Зарплата',
  'management': 'Менеджмент',
  'other': 'Другое'
};

/**
 * Maps sentiment values to Russian text
 */
const SENTIMENT_TEXT = {
  'POSITIVE': 'Позитивная',
  'NEGATIVE': 'Негативная',
  'NEUTRAL': 'Нейтральная',
  null: 'Не определена',
  undefined: 'Не определена'
};

/**
 * Formats an anonymous feedback message for the admin group
 * @param {Object} session - Session object containing message data
 * @param {string} session.category - Selected message category key (idea/problem/gratitude)
 * @param {string} session.topic - Selected message topic key
 * @param {string} session.messageText - User's message text
 * @param {string|null} session.sentiment - Sentiment analysis result (POSITIVE/NEGATIVE/NEUTRAL/null)
 * @returns {string} Formatted message for admin group
 */
export function formatAdminMessage(session) {
  const categoryName = CATEGORY_NAMES[session.category] || session.category;
  const categoryEmoji = CATEGORY_EMOJIS[session.category] || '📩';
  const topicName = TOPIC_NAMES[session.topic] || session.topic;
  const sentimentText = SENTIMENT_TEXT[session.sentiment] || 'Не определена';

  const formattedMessage = `📩 Новое анонимное сообщение

Категория: ${categoryEmoji} ${categoryName}
Тема: ${topicName}
Тональность: ${sentimentText}

Текст:
${session.messageText || '(медиафайл без текста)'}`;

  return formattedMessage;
}
