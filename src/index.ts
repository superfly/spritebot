import { config } from 'dotenv';
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  TextChannel,
  GuildMember,
  TextDisplayBuilder
} from 'discord.js';

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ]
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}!`);

  // Register slash commands
  const commands: any[] = [
    {
      name: 'setup-verify',
      description: 'Setup the verification message with a button',
      default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    },
  ];

  try {
    console.log('Registering slash commands...');
    await client.application?.commands.set(commands);
    console.log('Slash commands registered successfully!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    // Handle slash command
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    }

    // Handle button click
    if (interaction.isButton()) {
      await handleButtonClick(interaction);
    }

    // Handle modal submission
    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing your request.',
        ephemeral: true
      });
    }
  }
});

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName === 'setup-verify') {
    const message = 'Welcome to the **Sprites** Discord server!\n\nTo get access to all channels, please click the button below.';

    const button = new ButtonBuilder()
      .setCustomId('verify_button')
      .setLabel('Verify')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✅');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    await interaction.client.rest.post(`/channels/${interaction.channel!.id}/messages`, {
      auth: true,
      body: {
        content: message,
        components: [row]
      }
    });
  }
}

async function handleButtonClick(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === 'verify_button') {

    const roleId = '1466817825225048259';
    const role = interaction.guild?.roles.cache.get(roleId)!;  

    // Check if user already has the role
    const member = interaction.member;
    if (!(member instanceof GuildMember)) {
      await interaction.reply({
        content: '❌ An error occurred. Please try again.',
        ephemeral: true
      });
      return;
    }

    if (member.roles.cache.has(role.id)) {
      await interaction.reply({
        content: '✅ You are already verified!',
        ephemeral: true
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('verify_modal')
      .setTitle('Verify your Sprite!');

    const info = new TextDisplayBuilder()
    .setContent(`To get access to the Discord server, create a Sprite that shows your Discord username (\`${interaction.user.username}\`) somewhere in the page.`);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason_input')
      .setLabel('Link to your Sprite')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('mysprite.sprites.app')
      .setRequired(true)
      .setMaxLength(100);

    const secondRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);

    modal.addComponents(info, secondRow);

    await interaction.showModal(modal);
  }
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId === 'verify_modal') {
    await interaction.deferReply({ ephemeral: true });

    const spriteUrl = interaction.fields.getTextInputValue('reason_input').trim();
    const username = interaction.user.username;

    const roleId = '1466817825225048259';
    const role = interaction.guild?.roles.cache.get(roleId)!;  

    // Check if user already has the role
    const member = interaction.member;
    if (!(member instanceof GuildMember)) {
      await interaction.editReply({
        content: '❌ An error occurred. Please try again.',
      });
      return;
    }

    if (member.roles.cache.has(role.id)) {
      await interaction.editReply({
        content: '✅ You are already verified!',
      });
      return;
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
      await interaction.editReply({
        content: '❌ Invalid URL format. Please provide a valid Sprite URL (e.g., mysprite.sprites.app)',
      });
      return;
    }

    // Check if URL is a subdomain of sprites.app
    const hostname = parsedUrl.hostname.toLowerCase();
    if (!hostname.endsWith('.sprites.app')) {
      await interaction.editReply({
        content: '❌ This is not a Sprite! Please provide a URL such as mysprite.sprites.app or https://mysprite.sprites.app',
      });
      return;
    }

    // Fetch and verify the Sprite page
    try {
      // Set up fetch with 10 second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(fullUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        await interaction.editReply({
          content: `❌ Could not access the Sprite page. Make sure the URL is correct and the page is publicly accessible. (HTTP ${response.status})`,
        });
        return;
      }

      const pageContent = await response.text();

      // Check if the username appears in the page
      if (!pageContent.toLowerCase().includes(username.toLowerCase())) {
        await interaction.editReply({
          content: `❌ Your Discord username "\`${username}\`" was not found on the Sprite page. Please add it somewhere visible and try again (the bot does not run JavaScript, sorry).`,
        });
        return;
      }

      // Add the role
      await member.roles.add(role);

      await interaction.editReply({
        content: `✅ Verification successful. Welcome!`,
      });

      // Optional: Log verification to a channel
      const logChannel = interaction.guild?.channels.cache.find(
        ch => ch.name === 'verification-logs' && ch.isTextBased()
      ) as TextChannel | undefined;

      if (logChannel) {
        const logMessage = `**New Verification**\n` +
          `👤 **User:** ${interaction.user.tag} (${interaction.user.id})\n` +
          `🔗 **Sprite URL:** ${fullUrl}\n` +
          `⏰ **Time:** ${new Date().toLocaleString()}`;

        await logChannel.send(logMessage);
      }
    } catch (error) {
      console.error('Error verifying sprite:', error);

      // Check if it was a timeout
      if (error instanceof Error && error.name === 'AbortError') {
        await interaction.editReply({
          content: '❌ The Sprite page took too long to load (timeout after 10 seconds). Please try again.',
        });
      } else {
        await interaction.editReply({
          content: '❌ An error occurred while verifying your Sprite. Please make sure the URL is correct and try again.',
        });
      }
    }
  }
}

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('Error: DISCORD_TOKEN is not defined in .env file');
  process.exit(1);
}

client.login(token);
