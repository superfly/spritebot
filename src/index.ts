import { config } from 'dotenv';
import express, { Request, Response } from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { REST } from '@discordjs/rest';
import { API } from '@discordjs/core';
import {
  APIInteraction,
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  ComponentType,
  ButtonStyle,
  TextInputStyle,
  APIChatInputApplicationCommandInteraction,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
} from 'discord-api-types/v10';

config();

const app = express();
const PORT = process.env.PORT || 3000;

// Discord public key from environment
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const VERIFY_CHANNEL_ID = "1466797134580941024";
const VERIFY_MESSAGE_ID = "1467907518440276028";

if (!PUBLIC_KEY) {
  console.error('Error: DISCORD_PUBLIC_KEY is not defined in .env file');
  process.exit(1);
}

if (!BOT_TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN is not defined in .env file');
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.error('Error: ADMIN_USERNAME and ADMIN_PASSWORD must be defined in .env file');
  process.exit(1);
}

// Initialize Discord REST API client
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
const api = new API(rest);

// Basic auth middleware
function basicAuth(req: Request, res: Response, next: any) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Spritebot"');
    return res.status(401).send('Authentication required');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  if (password === ADMIN_PASSWORD) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(401).send('Invalid credentials');
}

// Verify Discord requests
app.post('/interactions', verifyKeyMiddleware(PUBLIC_KEY), async (req: Request, res: Response) => {
  const interaction = req.body as APIInteraction;

  // Handle PING from Discord (required for verification)
  if (interaction.type === InteractionType.Ping) {
    return res.send({
      type: InteractionResponseType.Pong,
    });
  }

  try {
    // Handle slash commands
    if (interaction.type === InteractionType.ApplicationCommand) {
      await handleSlashCommand(interaction as APIChatInputApplicationCommandInteraction, res);
      return;
    }

    // Handle button clicks
    if (interaction.type === InteractionType.MessageComponent) {
      await handleButtonClick(interaction as APIMessageComponentInteraction, res);
      return;
    }

    // Handle modal submissions
    if (interaction.type === InteractionType.ModalSubmit) {
      await handleModalSubmit(interaction as APIModalSubmitInteraction, res);
      return;
    }

    return res.status(400).json({ error: 'Unknown interaction type' });
  } catch (error) {
    console.error('Error handling interaction:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
});

async function handleSlashCommand(interaction: APIChatInputApplicationCommandInteraction, res: Response): Promise<void> {
  if (interaction.data.name === 'setup-verify') {
    const message = 'Welcome to the **Sprites** Discord server!\n\nTo get access to all channels, please click the button below.';

    // Send a deferred response first
    res.send({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });

    // Then send the actual message using Discord REST API
    const channelId = interaction.channel_id;

    await api.channels.createMessage(channelId, {
      content: message,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Primary,
              label: 'Verify',
              custom_id: 'verify_button',
              emoji: {
                name: '✅'
              }
            }
          ]
        }
      ]
    });

    // Delete the deferred response
    await api.interactions.deleteReply(interaction.application_id, interaction.token);
  }
}

async function handleButtonClick(interaction: APIMessageComponentInteraction, res: Response): Promise<void> {
  if (interaction.data.custom_id === 'verify_button') {
    const roleId = '1466817825225048259';

    // Check if user already has the role
    const memberRoles = interaction.member?.roles || [];
    if (memberRoles.includes(roleId)) {
      res.send({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: '✅ You are already verified!',
          flags: MessageFlags.Ephemeral,
        },
      });
      return;
    }

    // Show modal
    res.send({
      type: InteractionResponseType.Modal,
      data: {
        custom_id: 'verify_modal',
        title: 'Verify your Sprite!',
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `To get access to the Discord server, create a Sprite that shows your Discord username (\`${interaction.member!.user.username}\`) somewhere in the page.`
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.TextInput,
                custom_id: 'reason_input',
                label: 'Link to your Sprite',
                style: TextInputStyle.Short,
                placeholder: 'mysprite.sprites.app',
                required: true,
                max_length: 100,
              }
            ]
          }
        ]
      },
    });
  }
}

async function handleModalSubmit(interaction: APIModalSubmitInteraction, res: Response): Promise<void> {
  if (interaction.data.custom_id === 'verify_modal') {
    // Defer the response to give us time to verify
    res.send({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: {
        flags: MessageFlags.Ephemeral,
      },
    });

    // Extract the sprite URL from modal data
    const components = interaction.data.components as any;
    const actionRow = components[1];
    const textInput = actionRow.components.find((c: any) => c.custom_id === 'reason_input');
    const spriteUrl = textInput?.value?.trim() || '';

    const username = interaction.member!.user.username;
    const userId = interaction.member!.user.id;
    const guildId = interaction.guild_id!;
    const roleId = '1466817825225048259';

    // Check if user already has the role
    const memberRoles = interaction.member?.roles || [];
    if (memberRoles.includes(roleId)) {
      return editReply(interaction, '✅ You are already verified!');
    }

    // Normalize the URL
    let fullUrl = spriteUrl;
    if (!spriteUrl.startsWith('http://') && !spriteUrl.startsWith('https://')) {
      fullUrl = `https://${spriteUrl}`;
    }

    // Validate URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      return editReply(
        interaction,
        '❌ Invalid URL format. Please provide a valid Sprite URL (e.g., mysprite.sprites.app)'
      );
    }

    // Check if URL is a subdomain of sprites.app
    const hostname = parsedUrl.hostname.toLowerCase();
    if (!hostname.endsWith('.sprites.app')) {
      return editReply(
        interaction,
        '❌ This is not a Sprite! Please provide a URL such as mysprite.sprites.app or https://mysprite.sprites.app'
      );
    }

    // Fetch and verify the Sprite page
    try {
      // Set up fetch with 10 second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(fullUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return editReply(
          interaction,
          `❌ Could not access the Sprite page. Make sure the URL is correct and the page is publicly accessible. (HTTP ${response.status})`
        );
      }

      const pageContent = await response.text();

      // Check if the username appears in the page
      if (!pageContent.toLowerCase().includes(username.toLowerCase())) {
        return editReply(
          interaction,
          `❌ Your Discord username "\`${username}\`" was not found on the Sprite page. Please add it somewhere visible and try again (the bot does not run JavaScript, sorry).`
        );
      }

      // Add the role using Discord REST API
      try {
        await api.guilds.addRoleToMember(guildId, userId, roleId);
      } catch (error) {
        console.error('Failed to add role:', error);
        return editReply(
          interaction,
          '❌ Failed to add role. Please contact an administrator.'
        );
      }

      await editReply(interaction, '✅ Verification successful. Welcome!');

      // Optional: Log verification to a channel
      await logVerification(guildId, fullUrl, username, userId);
    } catch (error) {
      console.error('Error verifying sprite:', error);

      // Check if it was a timeout
      if (error instanceof Error && error.name === 'AbortError') {
        return editReply(
          interaction,
          '❌ The Sprite page took too long to load (timeout after 10 seconds). Please try again.'
        );
      } else {
        return editReply(
          interaction,
          '❌ An error occurred while verifying your Sprite. Please make sure the URL is correct and try again.'
        );
      }
    }
  }
}

async function editReply(interaction: APIModalSubmitInteraction, content: string): Promise<void> {
  await api.interactions.editReply(interaction.application_id, interaction.token, {
    content,
  });
}

async function logVerification(guildId: string, fullUrl: string, username: string, userId: string): Promise<void> {
  try {
    // Get all channels in the guild
    const channels = await api.guilds.getChannels(guildId);
    const logChannel = channels.find((ch) => ch.name === 'verification-logs');

    if (logChannel) {
      const logMessage = `**New Verification**\n` +
        `👤 **User:** ${username} (${userId})\n` +
        `🔗 **Sprite URL:** ${fullUrl}\n` +
        `⏰ **Time:** ${new Date().toLocaleString()}`;

      await api.channels.createMessage(logChannel.id, {
        content: logMessage,
      });
    }
  } catch (error) {
    console.error('Error logging verification:', error);
  }
}

// Admin page to edit verification message
app.get('/', basicAuth, (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spritebot Admin</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
          color: #5865F2;
          margin-top: 0;
        }
        label {
          display: block;
          margin-top: 20px;
          font-weight: 600;
          color: #333;
        }
        textarea {
          width: 100%;
          min-height: 150px;
          margin-top: 8px;
          padding: 12px;
          border: 2px solid #e0e0e0;
          border-radius: 4px;
          font-family: inherit;
          font-size: 14px;
          resize: vertical;
          box-sizing: border-box;
        }
        textarea:focus {
          outline: none;
          border-color: #5865F2;
        }
        .button-group {
          margin-top: 20px;
          display: flex;
          gap: 10px;
        }
        button {
          padding: 12px 24px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        .btn-primary {
          background: #5865F2;
          color: white;
        }
        .btn-primary:hover {
          background: #4752C4;
        }
        .btn-secondary {
          background: #e0e0e0;
          color: #333;
        }
        .btn-secondary:hover {
          background: #d0d0d0;
        }
        .message {
          margin-top: 15px;
          padding: 12px;
          border-radius: 4px;
          display: none;
        }
        .message.success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .message.error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        .info {
          background: #e7f3ff;
          padding: 15px;
          border-radius: 4px;
          margin-top: 20px;
          font-size: 13px;
          color: #004085;
        }
        .loading {
          display: none;
          margin-top: 10px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Spritebot Admin</h1>
        <p>Edit <code>#info</code> message</p>

        <label for="messageContent">Content (Markdown supported)</label>
        <textarea id="messageContent" placeholder="Loading..."></textarea>

        <div class="button-group">
          <button class="btn-primary" onclick="updateMessage()">Update Message</button>
          <button class="btn-secondary" onclick="loadMessage()">Reload</button>
        </div>

        <div id="statusMessage" class="message"></div>
        <div id="loading" class="loading">Processing...</div>
      </div>

      <script>
        async function loadMessage() {
          const textarea = document.getElementById('messageContent');
          const statusMessage = document.getElementById('statusMessage');

          try {
            const response = await fetch('/api/message');
            const data = await response.json();

            if (response.ok) {
              textarea.value = data.content;
              statusMessage.style.display = 'none';
            } else {
              showMessage(data.error || 'Failed to load message', 'error');
            }
          } catch (error) {
            showMessage('Error loading message: ' + error.message, 'error');
          }
        }

        async function updateMessage() {
          const textarea = document.getElementById('messageContent');
          const loading = document.getElementById('loading');
          const statusMessage = document.getElementById('statusMessage');

          const content = textarea.value.trim();
          if (!content) {
            showMessage('Message content cannot be empty', 'error');
            return;
          }

          loading.style.display = 'block';
          statusMessage.style.display = 'none';

          try {
            const response = await fetch('/api/message', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ content })
            });

            const data = await response.json();
            loading.style.display = 'none';

            if (response.ok) {
              showMessage('Message updated successfully!', 'success');
            } else {
              showMessage(data.error || 'Failed to update message', 'error');
            }
          } catch (error) {
            loading.style.display = 'none';
            showMessage('Error updating message: ' + error.message, 'error');
          }
        }

        function showMessage(text, type) {
          const statusMessage = document.getElementById('statusMessage');
          statusMessage.textContent = text;
          statusMessage.className = 'message ' + type;
          statusMessage.style.display = 'block';
        }

        // Load message on page load
        loadMessage();
      </script>
    </body>
    </html>
  `);
});

// API endpoint to get current message content
app.get('/api/message', basicAuth, async (req: Request, res: Response) => {
  try {
    const message = await api.channels.getMessage(VERIFY_CHANNEL_ID, VERIFY_MESSAGE_ID);
    res.json({ content: message.content });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// API endpoint to update message content
app.post('/api/message', basicAuth, express.json(), async (req: Request, res: Response) => {
  try {
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Get the current message to preserve components
    const currentMessage = await api.channels.getMessage(VERIFY_CHANNEL_ID, VERIFY_MESSAGE_ID);

    // Update message with new content but preserve components (the verify button)
    await api.channels.editMessage(VERIFY_CHANNEL_ID, VERIFY_MESSAGE_ID, {
      content: content.trim(),
      components: currentMessage.components || []
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
