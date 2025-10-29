# Deployment Guide

This guide provides step-by-step instructions for deploying the Anonymous Feedback Bot to Cloudflare Workers.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Create KV namespaces
npx wrangler kv:namespace create "KV"
npx wrangler kv:namespace create "KV" --preview

# 4. Update wrangler.toml with KV namespace IDs

# 5. Set secrets
npx wrangler secret put TELEGRAM_TOKEN
npx wrangler secret put ADMIN_CHAT_ID
npx wrangler secret put ACCESS_TOKEN

# 6. Deploy
npx wrangler deploy --env production

# 7. Register webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-worker.workers.dev"}'
```

## Detailed Deployment Steps

### Step 1: Prerequisites

Ensure you have:
- [x] Cloudflare account (free tier works)
- [x] Node.js v16+ installed
- [x] Telegram bot created via @BotFather
- [x] Admin group created with bot added
- [x] Wrangler CLI installed: `npm install -g wrangler`

### Step 2: Project Setup

```bash
# Clone repository
git clone <repository-url>
cd anonymous-feedback-bot

# Install dependencies
npm install

# Login to Cloudflare
wrangler login
```

### Step 3: Create KV Namespaces

KV (Key-Value) storage is used for session management and trusted user tracking.

```bash
# Create production namespace
wrangler kv:namespace create "KV"
```

Output example:
```
🌀 Creating namespace with title "anonymous-feedback-bot-KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "KV", id = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" }
```

```bash
# Create preview namespace (for local development)
wrangler kv:namespace create "KV" --preview
```

Output example:
```
🌀 Creating namespace with title "anonymous-feedback-bot-KV_preview"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "KV", preview_id = "z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4" }
```

### Step 4: Update wrangler.toml

Edit `wrangler.toml` and replace the placeholder IDs:

```toml
[[kv_namespaces]]
binding = "KV"
id = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"           # Your production ID
preview_id = "z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4"  # Your preview ID
```

### Step 5: Configure Secrets

#### Required Secrets

**TELEGRAM_TOKEN** - Get from @BotFather:
```bash
wrangler secret put TELEGRAM_TOKEN
# Enter: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

**ADMIN_CHAT_ID** - Get from Telegram API:
```bash
# First, send a message in your admin group, then:
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates

# Look for: "chat":{"id":-1001234567890,...}
wrangler secret put ADMIN_CHAT_ID
# Enter: -1001234567890
```

**ACCESS_TOKEN** - Generate secure random token:
```bash
# Generate token
openssl rand -hex 32
# Output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8

wrangler secret put ACCESS_TOKEN
# Enter: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8
```

### Step 6: Deploy to Production

```bash
# Deploy to production environment
wrangler deploy --env production
```

Expected output:
```
Total Upload: XX.XX KiB / gzip: XX.XX KiB
Uploaded anonymous-feedback-bot (X.XX sec)
Published anonymous-feedback-bot (X.XX sec)
  https://anonymous-feedback-bot.your-subdomain.workers.dev
Current Deployment ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Save your Worker URL** - you'll need it for webhook registration.

### Step 7: Register Webhook

Tell Telegram where to send updates:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://anonymous-feedback-bot.your-subdomain.workers.dev"}'
```

Expected response:
```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

### Step 8: Verify Deployment

**Check webhook status**:
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

Expected response:
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

**Test the bot**:
1. Create your deeplink: `https://t.me/<BOT_USERNAME>?start=<ACCESS_TOKEN>`
2. Open the link in Telegram
3. Bot should respond with welcome message
4. Try sending a test message through the full flow

### Step 9: Monitor Deployment

**View real-time logs**:
```bash
wrangler tail --env production
```

**Check Cloudflare Dashboard**:
- Navigate to: Workers & Pages → anonymous-feedback-bot
- View: Metrics, Logs, Settings

## Staging Environment Setup

For safe testing before production deployment:

### Step 1: Create Staging KV Namespace

```bash
wrangler kv:namespace create "KV" --env staging
```

### Step 2: Update wrangler.toml

Add staging-specific KV namespace:

```toml
[env.staging]
vars = { TEST_MODE = "true" }

[[env.staging.kv_namespaces]]
binding = "KV"
id = "your-staging-kv-namespace-id"
```

### Step 3: Set Staging Secrets

```bash
# Optional: Use a different test admin group
wrangler secret put ADMIN_CHAT_ID_TEST --env staging
# Enter: -1009876543210

# You can reuse the same TELEGRAM_TOKEN, ACCESS_TOKEN, etc.
# Or set different ones for complete isolation
```

### Step 4: Deploy to Staging

```bash
wrangler deploy --env staging
```

### Step 5: Register Staging Webhook

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://anonymous-feedback-bot-staging.your-subdomain.workers.dev"}'
```

## Deployment Checklist

Before deploying to production:

- [ ] KV namespaces created and configured in wrangler.toml
- [ ] All required secrets set (TELEGRAM_TOKEN, ADMIN_CHAT_ID, ACCESS_TOKEN)
- [ ] Bot added to admin group with send message permissions
- [ ] Access token is at least 32 random characters
- [ ] Tested in staging environment
- [ ] Webhook registered successfully
- [ ] Webhook verification shows correct URL
- [ ] Test message sent successfully through full flow
- [ ] Admin group receives formatted message
- [ ] User receives inspirational response
- [ ] Monitoring/logging configured

## Common Deployment Issues

### Issue: "Error: No namespace with ID found"

**Solution**: Update wrangler.toml with correct KV namespace IDs from Step 3.

### Issue: "Error: Authentication error"

**Solution**: Run `wrangler login` again to re-authenticate.

### Issue: Webhook registration fails

**Possible causes**:
- Worker not deployed yet (deploy first, then register webhook)
- Incorrect Worker URL
- Bot token invalid

**Solution**:
```bash
# Verify worker is deployed
wrangler deployments list --env production

# Use exact URL from deployment output
```

### Issue: Bot doesn't respond to messages

**Possible causes**:
- Webhook not registered
- Secrets not set correctly
- Worker has errors

**Solution**:
```bash
# Check webhook
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Check worker logs
wrangler tail --env production

# Verify secrets are set
wrangler secret list --env production
```

### Issue: Messages not reaching admin group

**Possible causes**:
- Incorrect ADMIN_CHAT_ID (must be negative number starting with -100)
- Bot not added to group
- Bot doesn't have send message permissions

**Solution**:
```bash
# Test sending message directly
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "<ADMIN_CHAT_ID>", "text": "Test"}'
```

## Updating Deployment

### Code Changes

```bash
# 1. Make changes to code
# 2. Test locally
wrangler dev

# 3. Deploy to staging
wrangler deploy --env staging

# 4. Test in staging
# 5. Deploy to production
wrangler deploy --env production
```

### Secret Changes

```bash
# Update a secret
wrangler secret put SECRET_NAME --env production

# List all secrets (doesn't show values)
wrangler secret list --env production

# Delete a secret
wrangler secret delete SECRET_NAME --env production
```

### Rollback

```bash
# List recent deployments
wrangler deployments list --env production

# Rollback to previous deployment
wrangler rollback --env production
```

## Monitoring and Maintenance

### View Logs

```bash
# Real-time logs
wrangler tail --env production

# Pretty formatted logs
wrangler tail --env production --format pretty

# Filter by status
wrangler tail --env production --status error
```

### KV Storage Management

```bash
# List all keys
wrangler kv:key list --binding KV --env production

# List with prefix
wrangler kv:key list --binding KV --env production --prefix "session:"

# Get specific key
wrangler kv:key get "session:123456" --binding KV --env production

# Delete key
wrangler kv:key delete "session:123456" --binding KV --env production

# Bulk delete (careful!)
wrangler kv:key list --binding KV --env production --prefix "test_log:" | \
  jq -r '.[].name' | \
  xargs -I {} wrangler kv:key delete {} --binding KV --env production
```

### Analytics

View in Cloudflare Dashboard:
- Workers & Pages → anonymous-feedback-bot → Metrics
- Requests per second
- Error rate
- CPU time
- KV operations

## Security Best Practices

1. **Rotate ACCESS_TOKEN quarterly**:
   ```bash
   openssl rand -hex 32
   wrangler secret put ACCESS_TOKEN --env production
   ```

2. **Use REVOKE_ALL_ACCESS when rotating**:
   ```bash
   wrangler secret put REVOKE_ALL_ACCESS --env production
   # Enter: true
   # Wait for all users to re-activate
   wrangler secret put REVOKE_ALL_ACCESS --env production
   # Enter: false
   ```

3. **Monitor for suspicious activity**:
   ```bash
   wrangler tail --env production | grep "Error"
   ```

4. **Keep secrets secure**:
   - Never commit secrets to git
   - Use `wrangler secret put` instead of environment variables in wrangler.toml
   - Limit access to Cloudflare account

5. **Regular backups**:
   ```bash
   # Export trusted users (for backup)
   wrangler kv:key list --binding KV --env production --prefix "trusted:" > backup-trusted-users.json
   ```

## Cost Estimation

### Cloudflare Workers Free Tier

- 100,000 requests/day
- 10ms CPU time per request
- Sufficient for small to medium companies (up to ~3,000 messages/day)

### Cloudflare Workers Paid Plan ($5/month)

- 10 million requests/month
- 50ms CPU time per request
- Suitable for large companies

### KV Storage

- Free: 1 GB storage, 100,000 reads/day, 1,000 writes/day
- Paid: $0.50/GB/month, $0.50/million reads, $5/million writes

### AI Gateway

- Pricing varies by model and usage
- Check Cloudflare AI pricing for current rates

## Support

For issues or questions:
1. Check [Troubleshooting section in README](README.md#troubleshooting)
2. Review [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
3. Check [Telegram Bot API documentation](https://core.telegram.org/bots/api)
4. Open an issue in the repository
