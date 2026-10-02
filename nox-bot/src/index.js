'use strict';

const { ActivityType, Client, Events, GatewayIntentBits, OAuth2Scopes, Partials, PermissionFlagsBits } = require('discord.js');
const { env, validateEnv } = require('./env');

const problems = validateEnv();
if (problems.length) {
  for (const p of problems) console.error(`❌ ${p}`);
  console.error('   Setup instructions: README.md');
  process.exit(1);
}

const config = require('./lib/config');
const db = require('./lib/db');
const panels = require('./lib/panels');
const loadCommands = require('./commands');
const handleInteraction = require('./handlers/interactions');
const tickets = require('./tickets/tickets');
const giveaways = require('./features/giveaways');
const welcome = require('./features/welcome');
const stats = require('./features/stats');
const { isStaff } = require('./lib/utils');
const { reportRoles } = require('./lib/permissions');
require('./features/shop');
require('./features/vouches');

db.load();
const commands = loadCommands();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildExpressions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  rest: {
    // Emoji uploads have a strict rate limit – fail fast instead of freezing /build for minutes.
    rejectOnRateLimit: (data) => data.route.includes('/emojis') && data.timeToReset > 15_000,
  },
});

const every = (ms, fn, firstDelay = ms) => {
  const run = () => Promise.resolve().then(fn).catch((err) => console.error('[timer]', err));
  setTimeout(run, firstDelay).unref?.();
  setInterval(run, ms).unref?.();
};

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag} · servers: ${c.guilds.cache.size} · commands: ${commands.size}`);
  reportRoles([...c.guilds.cache.values()], config.ticketTypes);

  if (env.autoDeployCommands) {
    const body = [...commands.values()].map((cmd) => cmd.data.toJSON());
    try {
      if (env.guildId) {
        await c.application.commands.set(body, env.guildId);
        console.log(`✅ Slash commands registered on server ${env.guildId} (available instantly).`);
      } else {
        await c.application.commands.set(body);
        console.log('✅ Slash commands registered globally (they can take a few minutes to appear – set GUILD_ID for instant updates).');
      }
    } catch (err) {
      console.error('❌ Failed to register slash commands:', err.message);
    }
  }

  const invite = c.generateInvite({ scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: [PermissionFlagsBits.Administrator] });
  console.log(`🔗 Invite link:\n   ${invite}`);
  if (!c.guilds.cache.size) console.log('ℹ️  The bot is not on any server yet – open the invite link above.');
  for (const guild of c.guilds.cache.values()) {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.Administrator)) {
      console.warn(`⚠️  ${guild.name}: the bot does not have the Administrator permission – /build will not work there.`);
    }
  }

  let presenceIndex = 0;
  const updatePresence = () => {
    const open = db.tickets((x) => x.status === 'open').length;
    const vouchCount = db.allGuildIds().reduce((n, id) => n + db.guild(id).vouches.length, 0);
    const list = [
      { name: `🛒 ${config.brand.name} · /help`, type: ActivityType.Watching },
      { name: `🎫 ${open} open ${open === 1 ? 'ticket' : 'tickets'}`, type: ActivityType.Watching },
      ...(vouchCount ? [{ name: `⭐ ${vouchCount} vouches`, type: ActivityType.Watching }] : []),
    ];
    c.user.setActivity(list[presenceIndex++ % list.length]);
  };
  updatePresence();
  every(60_000, updatePresence);

  every(5 * 60_000, () => tickets.runInactivityCheck(c), 30_000);
  every(15_000, () => giveaways.tick(c), 10_000);
  every(10 * 60_000, () => stats.updateStatChannels(c), 20_000);
  every(10 * 60_000, () => panels.refreshAll(c, 'leaderboard'), 25_000);
  const panelMinutes = config.defaults.panelRefreshMinutes ?? 5;
  if (panelMinutes > 0) every(panelMinutes * 60_000, () => panels.refreshAll(c, 'tickets'), 15_000);
});

client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction, commands));

client.on(Events.MessageCreate, (message) => {
  if (!message.guild || message.author.bot) return;
  stats.trackMessage(message);
  const ticket = db.getTicket(message.channel.id);
  if (!ticket || ticket.status !== 'open') return;
  const fromStaff = message.author.id !== ticket.ownerId && isStaff(message.member, config.getType(ticket.typeId));
  const patch = { lastActivity: Date.now(), lastMessageBy: fromStaff ? 'staff' : 'owner', warned: false };
  if (fromStaff && !ticket.firstResponseAt) {
    patch.firstResponseAt = Date.now();
    tickets.schedulePanelRefresh(message.guild);
  }
  if (!fromStaff && ticket.closeRequest) patch.closeRequest = null;
  db.updateTicket(message.channel.id, patch);
});

client.on(Events.GuildMemberAdd, (member) => welcome.onMemberAdd(member).catch((err) => console.warn('[welcome]', err.message)));
client.on(Events.GuildMemberRemove, (member) => welcome.onMemberRemove(member).catch((err) => console.warn('[leave]', err.message)));
client.on(Events.MessageDelete, (message) => welcome.onMessageDelete(message).catch(() => null));
client.on(Events.MessageUpdate, (before, after) => welcome.onMessageUpdate(before, after).catch(() => null));

client.on(Events.ChannelDelete, (channel) => {
  const ticket = db.getTicket(channel.id);
  if (ticket && ticket.status !== 'deleted') {
    db.updateTicket(channel.id, { status: 'deleted', deletedAt: Date.now() });
    tickets.schedulePanelRefresh(channel.guild);
  }
});

client.on(Events.GuildCreate, (guild) => console.log(`➕ Added to server: ${guild.name} (${guild.id}) – run /build there to set it up.`));
client.on(Events.Error, (err) => console.error('[discord]', err));

function shutdown() {
  console.log('Saving data and shutting down…');
  try {
    db.flush();
  } catch (err) {
    console.error('[db]', err.message);
  }
  client.destroy().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

client.login(env.token).catch((err) => {
  if (/disallowed intents/i.test(err.message)) {
    console.error(
      '❌ Discord rejected the connection: privileged intents are not enabled.\n' +
        '   Fix: https://discord.com/developers/applications → your bot → Bot tab → Privileged Gateway Intents →\n' +
        '   turn ON "SERVER MEMBERS INTENT" and "MESSAGE CONTENT INTENT" → Save Changes, then restart the bot.',
    );
  } else if (err.code === 'TokenInvalid' || /token/i.test(err.message)) {
    console.error('❌ Invalid DISCORD_TOKEN. Generate a new one (Bot tab → Reset Token), paste it into .env and restart the bot.');
  } else {
    console.error('❌ Failed to log in:', err);
  }
  process.exit(1);
});
