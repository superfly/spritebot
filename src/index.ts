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

if (!PUBLIC_KEY) {
  console.error('Error: DISCORD_PUBLIC_KEY is not defined in .env file');
  process.exit(1);
}

if (!BOT_TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN is not defined in .env file');
  process.exit(1);
}

// Initialize Discord REST API client
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
const api = new API(rest);

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
    const actionRow = components[0];
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

app.get('/', (req: Request, res: Response) => {
  res.send('Discord Interactions Webhook Listener is running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
