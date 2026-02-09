# Spritebot - Discord Interactions Webhook Listener

A Discord bot that handles interactions via webhooks for sprite verification.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your Discord credentials:

```bash
cp .env.example .env
```

You'll need:
- `DISCORD_BOT_TOKEN`: Your bot token from the Discord Developer Portal
- `DISCORD_PUBLIC_KEY`: Your application's public key (found in General Information)
- `PORT`: The port to run the server on (default: 3000)

### 3. Register Slash Commands

You need to register the `/setup-verify` command with Discord. Use this script or the Discord Developer Portal:

```bash
# Using curl (replace YOUR_APP_ID and YOUR_BOT_TOKEN)
curl -X POST \
  "https://discord.com/api/v10/applications/YOUR_APP_ID/commands" \
  -H "Authorization: Bot YOUR_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "setup-verify",
    "description": "Setup the verification message with a button",
    "default_member_permissions": "8"
  }'
```

### 4. Configure Discord Webhook

1. Go to your application in the Discord Developer Portal
2. Navigate to "General Information"
3. Set the "Interactions Endpoint URL" to your server's URL + `/interactions`
   - Example: `https://your-domain.com/interactions`
4. Discord will send a PING request to verify the endpoint

### 5. Build and Run

```bash
npm run build
npm start
```

For development:

```bash
npm run dev
```

## How It Works

This bot uses Discord's interactions webhook system instead of the gateway API:

1. **HTTP Server**: Listens for POST requests from Discord at `/interactions`
2. **Signature Verification**: Uses the `discord-interactions` library to verify requests with Ed25519
3. **Interaction Handling**: Responds to slash commands, buttons, and modal submissions
4. **Sprite Verification**: Fetches user-provided sprite URLs and checks for Discord username

## Endpoints

- `POST /interactions`: Discord interactions webhook endpoint
- `GET /`: Health check endpoint

## Verification Flow

1. Admin runs `/setup-verify` to create verification message
2. User clicks "Verify" button
3. Modal opens requesting sprite URL
4. Bot fetches the sprite page and verifies username is present
5. Bot assigns role to verified user