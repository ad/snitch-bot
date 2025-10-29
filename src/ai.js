/**
 * AI Sentiment Analysis Module
 * Handles Cloudflare AI Gateway integration for sentiment analysis
 */

/**
 * Check if AI functionality is enabled
 * @param {Object} env - Environment bindings
 * @returns {boolean} - True if both CF_AI_TOKEN and ACCOUNT_ID are present
 */
export function isAIEnabled(env) {
    return !!(env.CF_AI_TOKEN && env.ACCOUNT_ID);
}

/**
 * Analyze sentiment of text using Cloudflare AI Gateway
 * @param {string} text - Text to analyze
 * @param {Object} env - Environment bindings
 * @returns {Promise<{sentiment: string, confidence: number}|null>} - Sentiment result or null on error/disabled
 */
export async function analyzeSentiment(text, env) {
    // Return null if AI is disabled
    if (!isAIEnabled(env)) {
        console.log('AI is disabled - skipping sentiment analysis');
        return null;
    }

    // Return null if text is empty or not a string
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        console.log('Invalid text for sentiment analysis');
        return null;
    }

    try {
        const result = await callAI(text, env, 5000);

        if (!result || !Array.isArray(result)) {
            console.log('Invalid AI response format');
            return null;
        }

        // Find the highest scoring sentiment
        let positiveScore = 0;
        let negativeScore = 0;

        for (const item of result) {
            if (item && item.label === 'POSITIVE' && typeof item.score === 'number') {
                positiveScore = item.score;
            } else if (item && item.label === 'NEGATIVE' && typeof item.score === 'number') {
                negativeScore = item.score;
            }
        }

        // Map scores to sentiment categories
        let sentiment = 'NEUTRAL';
        let confidence = 0;

        if (negativeScore > 0.6) {
            sentiment = 'NEGATIVE';
            confidence = negativeScore;
        } else if (positiveScore > 0.6) {
            sentiment = 'POSITIVE';
            confidence = positiveScore;
        } else {
            // Neutral case - use the higher score
            confidence = Math.max(positiveScore, negativeScore);
        }

        return { sentiment, confidence };
    } catch (error) {
        console.error('Sentiment analysis error:', error.message, error.stack);
        // Return null for graceful degradation
        return null;
    }
}

/**
 * Call Cloudflare AI Gateway with timeout
 * @param {string} text - Text to analyze
 * @param {Object} env - Environment bindings
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 * @returns {Promise<Array|null>} - AI response or null on error/timeout
 */
async function callAI(text, env, timeout = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        if (!env.ACCOUNT_ID || !env.CF_AI_TOKEN) {
            console.error('Missing AI credentials');
            return null;
        }

        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/run/@cf/huggingface/distilbert-sst-2-int8`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.CF_AI_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text }),
                signal: controller.signal,
            }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error('AI Gateway error:', response.status, response.statusText);
            
            // Log specific error codes
            if (response.status === 401) {
                console.error('AI Gateway authentication failed - invalid token');
            } else if (response.status === 429) {
                console.error('AI Gateway rate limit exceeded');
            }
            
            return null;
        }

        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            console.error('Failed to parse AI Gateway response:', parseError.message);
            return null;
        }

        // Cloudflare AI returns result in different formats depending on the model
        // For sentiment analysis, it typically returns an array of label/score objects
        if (data.result) {
            return data.result;
        }

        console.log('AI Gateway response missing result field');
        return null;
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            console.error('AI Gateway timeout after', timeout, 'ms - continuing without sentiment analysis');
        } else {
            console.error('AI Gateway request failed:', error.message, error.stack);
        }

        // Return null for graceful degradation
        return null;
    }
}
