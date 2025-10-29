# Anonymous Feedback Bot

Telegram-бот для анонимной обратной связи сотрудников компании, работающий на платформе Cloudflare Workers с интеграцией Cloudflare AI для анализа тональности сообщений.

## Features

- 🔐 Secure activation via secret deeplink
- 💬 Anonymous message forwarding to admin group
- 📊 AI-powered sentiment analysis (optional)
- 🎯 Message categorization (Ideas, Problems, Gratitude)
- 🏷️ Topic selection (Processes, Colleagues, Conditions, Salary, Management, Other)
- 💪 Inspirational responses to users
- 🚀 Serverless deployment on Cloudflare Workers

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [User Activation](#user-activation)
- [Usage](#usage)
- [TEST_MODE for Staging](#test_mode-for-staging)
- [Maintenance](#maintenance)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Prerequisites

- Cloudflare account with Workers plan
- Telegram Bot Token (get from [@BotFather](https://t.me/BotFather))
- Telegram group for admins
- Node.js (v16 or higher) and npm installed locally
- Wrangler CLI (`npm install -g wrangler`)

## Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd anonymous-feedback-bot
npm install
```

### 2. Create Telegram Bot

1. Open Telegram and find [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow instructions to create your bot
4. Save the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
5. Save your bot username (e.g., `my_feedback_bot`)

### 3. Create Admin Group

1. Create a new Telegram group
2. Add your bot to the group
3. Make the bot an admin (optional, but recommended)
4. Send a test message in the group
5. Get the chat ID:

```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

6. Look for `"chat":{"id":-1001234567890,...}` in the response
7. The chat ID will be a negative number starting with `-100`

### 4. Create KV Namespace

```bash
# Login to Cloudflare
wrangler login

# Create production KV namespace
wrangler kv:namespace create "KV"

# Create preview KV namespace for development
wrangler kv:namespace create "KV" --preview
```

Copy the namespace IDs from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "your-production-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"
```

### 5. Generate Access Token

Generate a secure random token for user activation:

```bash
# On macOS/Linux
openssl rand -hex 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save this token - you'll use it for the deeplink and as the `ACCESS_TOKEN` environment variable.

### 6. Configure Secrets

Set required secrets using Wrangler:

```bash
# Required secrets
wrangler secret put TELEGRAM_TOKEN
# Enter your bot token when prompted

wrangler secret put ADMIN_CHAT_ID
# Enter your admin group chat ID (e.g., -1001234567890)

wrangler secret put ACCESS_TOKEN
# Enter the token you generated in step 5
```

Optional secrets for AI sentiment analysis:

```bash
wrangler secret put ACCOUNT_ID
# Enter your Cloudflare Account ID (found in Cloudflare Dashboard)

wrangler secret put CF_AI_TOKEN
# Enter your Cloudflare AI API token
```

Optional secrets for staging/testing:

```bash
wrangler secret put ADMIN_CHAT_ID_TEST
# Enter your test group chat ID for staging environment
```

## Deployment

### Production Deployment

1. **Update wrangler.toml** with your worker name:

```toml
name = "anonymous-feedback-bot"
main = "src/index.js"
compatibility_date = "2024-01-01"

[env.production]
vars = { TEST_MODE = "false" }

[[kv_namespaces]]
binding = "KV"
id = "your-production-kv-namespace-id"
```

2. **Deploy to Cloudflare Workers**:

```bash
wrangler deploy --env production
```

3. **Note your Worker URL** from the output (e.g., `https://anonymous-feedback-bot.your-subdomain.workers.dev`)

4. **Register Webhook with Telegram**:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://anonymous-feedback-bot.your-subdomain.workers.dev"}'
```

Expected response:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

5. **Verify Webhook Registration**:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

Expected response should show:
```json
{
  "ok": true,
  "result": {
    "url": "https://anonymous-feedback-bot.your-subdomain.workers.dev",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "max_connections": 40
  }
}
```

### Staging Deployment

For testing in a staging environment:

1. **Create a test bot** (optional, or reuse the same bot)
2. **Create a test admin group**
3. **Update wrangler.toml** with staging configuration:

```toml
[env.staging]
vars = { TEST_MODE = "true" }

[[env.staging.kv_namespaces]]
binding = "KV"
id = "your-staging-kv-namespace-id"
```

4. **Set staging-specific secrets**:

```bash
wrangler secret put ADMIN_CHAT_ID_TEST --env staging
# Enter your test group chat ID
```

5. **Deploy to staging**:

```bash
wrangler deploy --env staging
```

6. **Register webhook for staging**:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://anonymous-feedback-bot-staging.your-subdomain.workers.dev"}'
```

### Deployment Commands Reference

```bash
# Deploy to production
wrangler deploy --env production

# Deploy to staging
wrangler deploy --env staging

# View deployment logs
wrangler tail --env production

# View KV storage
wrangler kv:key list --binding KV --env production

# Delete a KV key (for testing)
wrangler kv:key delete "session:123456" --binding KV --env production
```

## Environment Variables

### Required Variables

| Variable | Description | Example | How to Set |
|----------|-------------|---------|------------|
| `TELEGRAM_TOKEN` | Bot API token from @BotFather | `123456789:ABCdefGHI...` | `wrangler secret put TELEGRAM_TOKEN` |
| `ADMIN_CHAT_ID` | Admin group chat ID (negative number) | `-1001234567890` | `wrangler secret put ADMIN_CHAT_ID` |
| `ACCESS_TOKEN` | Secret activation token (min 32 chars) | `a1b2c3d4e5f6...` | `wrangler secret put ACCESS_TOKEN` |

### Optional Variables (AI Sentiment Analysis)

| Variable | Description | Example | How to Set |
|----------|-------------|---------|------------|
| `ACCOUNT_ID` | Cloudflare Account ID | `abc123def456...` | `wrangler secret put ACCOUNT_ID` |
| `CF_AI_TOKEN` | Cloudflare AI API token | `xyz789...` | `wrangler secret put CF_AI_TOKEN` |

**Note**: Both `ACCOUNT_ID` and `CF_AI_TOKEN` must be set for AI sentiment analysis to work. If either is missing, the bot will work without AI features (graceful degradation).

### Optional Variables (Testing & Administration)

| Variable | Description | Example | How to Set |
|----------|-------------|---------|------------|
| `TEST_MODE` | Enable test mode (set in wrangler.toml) | `true` / `false` | Set in `wrangler.toml` vars |
| `ADMIN_CHAT_ID_TEST` | Test admin group chat ID | `-1009876543210` | `wrangler secret put ADMIN_CHAT_ID_TEST` |
| `REVOKE_ALL_ACCESS` | Revoke all user access | `true` / `false` | `wrangler secret put REVOKE_ALL_ACCESS` |

### Environment Variable Configuration

**Via Wrangler Secrets** (recommended for sensitive data):
```bash
wrangler secret put VARIABLE_NAME
```

**Via wrangler.toml** (for non-sensitive configuration):
```toml
[env.production]
vars = { TEST_MODE = "false" }
```

**Via .env file** (local development only):
```bash
cp .env.example .env
# Edit .env with your values
```

## User Activation

### Deeplink Format

The deeplink format for user activation is:

```
https://t.me/<BOT_USERNAME>?start=<ACCESS_TOKEN>
```

**Example**:
```
https://t.me/my_feedback_bot?start=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### Creating the Deeplink

1. Replace `<BOT_USERNAME>` with your bot's username (without @)
2. Replace `<ACCESS_TOKEN>` with the token you set in environment variables
3. Share this link with employees via email, intranet, or internal communication channels

### Security Considerations

- Keep the `ACCESS_TOKEN` secret - only share the complete deeplink with authorized employees
- The token should be at least 32 random characters
- Rotate the token periodically (quarterly recommended)
- When rotating, use `REVOKE_ALL_ACCESS=true` to force re-activation

### Activation Flow

1. Employee clicks the deeplink
2. Telegram opens the bot with the `/start <ACCESS_TOKEN>` command
3. Bot validates the token against `ACCESS_TOKEN` environment variable
4. If valid: user is marked as trusted (stored in KV for 90 days)
5. If invalid: user receives a neutral message without revealing bot purpose

## Usage

### For Employees (End Users)

1. **Activate the bot**: Click the deeplink provided by your company
2. **Start conversation**: The bot will show a welcome message
3. **Select category**: Choose from:
   - 💬 Идея / предложение (Idea / Suggestion)
   - ⚠️ Проблема / жалоба (Problem / Complaint)
   - ❤️ Благодарность / признание (Gratitude / Recognition)
4. **Select topic**: Choose from:
   - Процессы (Processes)
   - Коллеги (Colleagues)
   - Условия (Conditions)
   - Зарплата (Salary)
   - Менеджмент (Management)
   - Другое (Other)
5. **Write message**: Type your message (text + optional photo/video/document)
6. **Review sentiment** (if AI enabled): If negative sentiment detected, choose to rewrite or send as-is
7. **Confirm**: Message is sent anonymously to admin group
8. **Receive response**: Get an inspirational message confirming submission

### For Administrators

Messages appear in the admin group with this format:

```
📩 Новое анонимное сообщение

Категория: 💬 Идея / предложение
Тема: Процессы
Тональность: Позитивная

Текст:
[User's message here]
```

## TEST_MODE for Staging

`TEST_MODE` is a special environment variable that enables safe testing without affecting production data.

### When to Use TEST_MODE

- Testing bot functionality before production deployment
- Developing new features
- Training administrators
- Debugging issues

### How TEST_MODE Works

When `TEST_MODE=true`:

1. **Separate Admin Group**: Messages are sent to `ADMIN_CHAT_ID_TEST` instead of `ADMIN_CHAT_ID`
2. **Message Logging**: All messages are logged to KV storage with `test_log:` prefix
3. **No Production Impact**: Production admin group receives no test messages

### Setting Up TEST_MODE

**In wrangler.toml**:
```toml
[env.staging]
vars = { TEST_MODE = "true" }

[[env.staging.kv_namespaces]]
binding = "KV"
id = "your-staging-kv-namespace-id"
```

**Set test admin group**:
```bash
wrangler secret put ADMIN_CHAT_ID_TEST --env staging
```

**Deploy staging environment**:
```bash
wrangler deploy --env staging
```

### Switching Between Environments

**Production** (TEST_MODE=false):
```bash
wrangler deploy --env production
```

**Staging** (TEST_MODE=true):
```bash
wrangler deploy --env staging
```

### Viewing Test Logs

```bash
# List all test logs
wrangler kv:key list --binding KV --env staging --prefix "test_log:"

# Get specific log
wrangler kv:key get "test_log:1234567890" --binding KV --env staging

# Clear test logs
wrangler kv:key delete "test_log:1234567890" --binding KV --env staging
```

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run locally with wrangler
npm run dev

# Or use wrangler directly
wrangler dev
```

### Testing Locally

1. Set up a local `.env` file (copy from `.env.example`)
2. Use `wrangler dev` to run locally
3. Use a tool like `ngrok` to expose your local server:

```bash
ngrok http 8787
```

4. Register the ngrok URL as webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-ngrok-url.ngrok.io"}'
```

### Viewing Logs

```bash
# Real-time logs for production
wrangler tail --env production

# Real-time logs for staging
wrangler tail --env staging

# Filter logs
wrangler tail --env production --format pretty
```

## Maintenance

### Rotating Access Token

To change the access token (e.g., after employee departures):

1. **Generate new token**:
```bash
openssl rand -hex 32
```

2. **Update secret**:
```bash
wrangler secret put ACCESS_TOKEN --env production
```

3. **Revoke all existing access** (optional):
```bash
wrangler secret put REVOKE_ALL_ACCESS --env production
# Enter: true
```

4. **Deploy**:
```bash
wrangler deploy --env production
```

5. **Distribute new deeplink** with new token to employees

6. **Reset REVOKE_ALL_ACCESS** (after all users re-activate):
```bash
wrangler secret put REVOKE_ALL_ACCESS --env production
# Enter: false
```

### Monitoring

**Cloudflare Dashboard**:
- Navigate to Workers & Pages → Your Worker
- View Analytics: requests, errors, CPU time
- View Logs: real-time execution logs

**KV Storage Monitoring**:
```bash
# List all keys
wrangler kv:key list --binding KV --env production

# Check specific user session
wrangler kv:key get "session:123456789" --binding KV --env production

# Check trusted users
wrangler kv:key list --binding KV --env production --prefix "trusted:"
```

### Updating the Bot

1. Make code changes
2. Test locally with `wrangler dev`
3. Deploy to staging: `wrangler deploy --env staging`
4. Test in staging environment
5. Deploy to production: `wrangler deploy --env production`

## Security

### Best Practices

- **Access Token**: Use at least 32 random characters (use `openssl rand -hex 32`)
- **Token Rotation**: Rotate access token quarterly or after employee departures
- **Anonymity**: User telegram IDs are never stored in forwarded messages
- **Data Retention**: 
  - Session data expires automatically (1 hour TTL)
  - Trusted user status expires after 90 days
- **Secrets Management**: Always use `wrangler secret put` for sensitive data
- **Webhook Security**: Telegram validates webhook requests from known IP ranges
- **Environment Isolation**: Use separate bots/groups for staging and production

### Privacy Guarantees

- No user identifying information is stored beyond the trusted user flag
- Messages forwarded to admin group contain no sender information
- KV storage entries have automatic expiration (TTL)
- No persistent logging of message content (except in TEST_MODE)

## Troubleshooting

### Bot Not Responding

**Check webhook status**:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

**Verify webhook is set correctly**:
- URL should match your Worker URL
- `pending_update_count` should be 0
- No errors in `last_error_message`

**Check Worker logs**:
```bash
wrangler tail --env production
```

### Messages Not Reaching Admin Group

**Verify admin chat ID**:
- Must be a negative number starting with `-100`
- Bot must be added to the group
- Bot should have permission to send messages

**Test manually**:
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "<ADMIN_CHAT_ID>", "text": "Test message"}'
```

### AI Sentiment Analysis Not Working

**Check if AI is enabled**:
- Both `ACCOUNT_ID` and `CF_AI_TOKEN` must be set
- Verify in Cloudflare Dashboard: Workers & Pages → AI

**Check AI quota**:
- Navigate to Cloudflare Dashboard → AI
- Verify you haven't exceeded your plan limits

**Note**: Bot works without AI (graceful degradation) - this is expected behavior if AI credentials are not configured

### Users Cannot Activate

**Verify access token**:
```bash
# Check if secret is set
wrangler secret list --env production
```

**Check deeplink format**:
- Format: `https://t.me/<BOT_USERNAME>?start=<ACCESS_TOKEN>`
- Bot username should not include `@`
- Access token must match exactly

**Check KV storage**:
```bash
# List trusted users
wrangler kv:key list --binding KV --env production --prefix "trusted:"
```

### KV Storage Issues

**Check namespace binding**:
- Verify `wrangler.toml` has correct KV namespace IDs
- Ensure binding name is `KV`

**Check storage quota**:
- Free tier: 1 GB storage, 100,000 reads/day, 1,000 writes/day
- Upgrade plan if limits exceeded

### Webhook Registration Fails

**Common issues**:
- URL must be HTTPS
- URL must be publicly accessible
- Telegram must be able to reach the URL

**Re-register webhook**:
```bash
# Delete existing webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"

# Set new webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-worker.workers.dev"}'
```

## Additional Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
- [Cloudflare AI Documentation](https://developers.cloudflare.com/ai/)
- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)

## License

MIT