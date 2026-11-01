'use strict';

const {
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS, banner } = require('../lib/theme');
const { isOwner, isAdmin } = require('../lib/permissions');
const { ts, truncate, duration, embed, plural, count } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');
const { container, text, divider, btn, linkBtn, row, header, gallery, v2, channelUrl } = require('../lib/v2');
const { ROLES, CATEGORIES } = require('./layout');
const { buildServer } = require('./executor');
const { refreshContent } = require('./refresh');
const { syncEmojis, describeEmojiResult } = require('./emojis');
const { restyleNames } = require('./rename');
const { addMissing, removeRetired } = require('./update');
const style = require('./style');
const { EMOJI_PRIORITY } = require('../lib/theme');

/** One build per server at a time. */
const running = new Map();

const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function canBuild(member) {
  return isOwner(member) || isAdmin(member);
}

function previewCard(guild, member) {
  const c = container(COLORS.brand);
  const file = banner('welcome');
  c.addMediaGalleryComponents(gallery(`attachment://${file.name}`));
  const channels = CATEGORIES.reduce((n, cat) => n + cat.channels.length, 0);
  const prev = db.build(guild.id);
  header(
    c,
    `# ${e(guild, 'sparkles')} Zbuduj ${config.brand.name}\n` +
      `To polecenie stawia cały serwer **${config.brand.name}** za jednym razem – role, kanały, uprawnienia, banery, ` +
      'własne emotki, weryfikację, sklep, tickety, opinie, giveawaye, AutoMod i więcej.',
    null,
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `### ${e(guild, 'box')} Co zostanie utworzone\n` +
        `> 🎭 **${ROLES.length}** ${plural(ROLES.length, 'rola', 'role', 'ról')} w jasnopomarańczowej palecie (własna rola bota HammerShop, CEO → Członek + role z powiadomieniami)\n` +
        `> 📁 **${CATEGORIES.length}** ${plural(CATEGORIES.length, 'kategoria', 'kategorie', 'kategorii')}, a w nich **${channels}** ${plural(channels, 'kanał', 'kanały', 'kanałów')} z dopracowanymi uprawnieniami\n` +
        `> 🖼️ Własne banery i karty na każdym kanale informacyjnym\n` +
        `> 😀 Do **${EMOJI_PRIORITY.length}** jasnopomarańczowych emotek (tyle, ile zmieści Twój serwer)\n` +
        '> ✅ Weryfikacja · 🛒 sklep na żywo · 🎫 tickety · ⭐ opinie · 🎉 giveawaye · 🏆 ranking\n' +
        `> 🤖 AutoMod (spam, raidy, oszustwa, zaproszenia) · nazwa serwera **${config.brand.name}** + ikona`,
    ),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      CATEGORIES.map((cat) => `**${style.categoryName(cat.name)}**\n-# ${cat.channels.map((ch) => style.channelName(ch.name)).join(' · ') || 'tutaj pojawią się kanały ticketów'}`).join('\n'),
    ),
  );
  c.addSeparatorComponents(divider());
  const notes = [
    `${e(guild, 'info')} **Zbuduj** dodaje wszystko obok Twoich obecnych kanałów. **Wyczyść i zbuduj** najpierw usuwa wszystkie kanały, role i reguły AutoMod (tylko właściciel serwera).`,
    `${e(guild, 'warning')} Osoby bez roli Członek muszą się zweryfikować. Obecni członkowie dostaną ją automatycznie.`,
  ];
  if (prev?.at) notes.unshift(`${e(guild, 'warning')} **${config.brand.name} zbudowano tu już** ${ts(prev.at, 'R')}. Ponowna budowa bez czyszczenia utworzy zduplikowane kanały.`);
  c.addTextDisplayComponents(text(notes.join('\n')));
  c.addActionRowComponents(
    row(
      btn('build:go', 'Zbuduj', ce(guild, 'rocket'), ButtonStyle.Success),
      btn('build:wipe', 'Wyczyść i zbuduj', ce(guild, 'warning'), ButtonStyle.Danger).setDisabled(!isOwner(member)),
      btn('build:cancel', 'Anuluj', ce(guild, 'x'), ButtonStyle.Secondary),
    ),
  );
  return { ...v2(c, { files: [file] }), flags: V2_EPHEMERAL };
}

function progressCard(guild, s, { finishedPhases = [] } = {}) {
  const pct = Math.min(100, Math.round((s.done / Math.max(1, s.total)) * 100));
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  const bar = `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${e(guild, 'gear')} Budujemy ${config.brand.name}…\n\`${bar}\` **${pct}%**\n` +
        `**Teraz:** ${s.phase}${s.label ? ` – ${truncate(s.label, 80)}` : ''}\n` +
        (finishedPhases.length ? `${finishedPhases.map((p) => `${e(guild, 'check')} ${p}`).join('\n')}\n` : '') +
        `-# ⏱️ ${duration(s.elapsed)} · Nie zamykaj tej wiadomości – choć nawet jeśli zamkniesz Discorda, budowa i tak będzie trwać.`,
    ),
  );
  c.addActionRowComponents(row(btn('build:stop', 'Zatrzymaj', ce(guild, 'x'), ButtonStyle.Secondary)));
  return { components: [c], flags: MessageFlags.IsComponentsV2, attachments: [] };
}

function resultCard(guild, R, { originChannelId, wipe }) {
  const ok = !R.fatal && !R.aborted;
  const c = container(ok ? COLORS.success : R.aborted ? COLORS.warning : COLORS.danger);
  const title = ok ? `${e(guild, 'check')} Serwer ${config.brand.name} jest gotowy!` : R.aborted ? '⏹️ Budowa zatrzymana' : '💥 Budowa nie powiodła się';
  const head = [`# ${title}`];
  const n = (v, one, few, many) => `**${v}** ${plural(v, one, few, many)}`;
  if (R.fatal) head.push(`**Błąd:** ${R.fatal}`);
  head.push(
    `> 🎭 ${n(R.created.roles, 'rola', 'role', 'ról')} · 📁 ${n(R.created.categories, 'kategoria', 'kategorie', 'kategorii')} · 💬 ${n(R.created.channels, 'kanał', 'kanały', 'kanałów')}\n` +
      `> 📨 ${n(R.created.messages, 'wiadomość', 'wiadomości', 'wiadomości')} · 🤖 ${n(R.created.automod, 'reguła AutoMod', 'reguły AutoMod', 'reguł AutoMod')} · 😀 ${n(R.created.emojis, 'wgrana emotka', 'wgrane emotki', 'wgranych emotek')}`,
  );
  if (wipe) head.push(`-# Usunięto: ${count(R.deleted.channels, 'kanał', 'kanały', 'kanałów')} · ${count(R.deleted.roles, 'rolę', 'role', 'ról')} · ${count(R.deleted.automod, 'regułę AutoMod', 'reguły AutoMod', 'reguł AutoMod')}`);
  head.push(`-# ⏱️ ${duration(R.duration)}${R.community ? ' · 🌐 Tryb społeczności włączony' : ''}`);
  c.addTextDisplayComponents(text(head.join('\n')));

  const notes = [...R.errors, ...R.warnings];
  if (notes.length) {
    c.addSeparatorComponents(divider());
    const shown = notes.slice(0, 10).map((n) => `> ${truncate(n, 180)}`);
    if (notes.length > 10) shown.push(`> …i jeszcze ${notes.length - 10} (szczegóły w konsoli bota)`);
    c.addTextDisplayComponents(text(`### ${e(guild, 'warning')} Uwagi\n${shown.join('\n')}`));
  }
  if (ok) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(
      text(
        `### ${e(guild, 'sparkles')} Co dalej\n` +
          '> **1.** Ustawienia serwera → Role: przeciągnij rolę bota na samą górę\n' +
          `> **2.** Dodaj produkty komendą \`${slash('product add')}\` – od razu pojawią się w sklepie\n` +
          '> **3.** Nadaj zespołowi role (Manager, Support, Sprzedawca…)\n' +
          `> **4.** Opcjonalnie: edytuj \`config.json\` (płatności, teksty) i użyj \`${slash('build')} tylko:panels\``,
      ),
    );
  }
  const links = ['verify', 'shop', 'tickets', 'staffChat']
    .map((key) => [key, db.channelId(guild.id, key)])
    .filter(([, id]) => id && guild.channels.cache.has(id))
    .map(([key, id]) => linkBtn(channelUrl(guild.id, id), { verify: 'Weryfikacja', shop: 'Sklep', tickets: 'Tickety', staffChat: 'Czat zespołu' }[key], ce(guild, { verify: 'shield', shop: 'cart', tickets: 'ticket', staffChat: 'group' }[key])));
  if (links.length) c.addActionRowComponents(row(...links.slice(0, 4)));
  if (wipe && originChannelId && guild.channels.cache.has(originChannelId)) {
    c.addActionRowComponents(row(btn(`build:delorigin:${originChannelId}`, 'Usuń ten stary kanał', '🗑️', ButtonStyle.Danger)));
  }
  return { components: [c], flags: MessageFlags.IsComponentsV2, attachments: [] };
}

async function start(interaction) {
  const { guild, member } = interaction;
  if (!canBuild(member)) {
    return interaction.reply({ embeds: [embed(COLORS.danger).setDescription(`🔒 Z komendy \`${slash('build')}\` mogą korzystać tylko właściciel serwera i administratorzy.`)], flags: MessageFlags.Ephemeral });
  }
  if (!guild.members.me.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      embeds: [embed(COLORS.danger).setTitle('🔒 Potrzebuję uprawnienia Administrator').setDescription(`Ustawienia serwera → Role → moja rola → włącz **Administrator**, a potem użyj \`${slash('build')}\` jeszcze raz. (Albo zaproś mnie ponownie linkiem z konsoli.)`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (running.has(guild.id)) {
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription('⏳ Na tym serwerze trwa już budowa.')], flags: MessageFlags.Ephemeral });
  }

  const only = interaction.options.getString('only');
  if (only === 'emojis') return runEmojis(interaction);
  if (only === 'panels') return runRepost(interaction);
  if (only === 'names') return runNames(interaction);
  if (only === 'update') return runUpdate(interaction);
  return interaction.reply(previewCard(guild, member));
}

async function runEmojis(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  running.set(interaction.guild.id, { abort: false });
  try {
    const res = await syncEmojis(interaction.guild, { reason: `Emotki ${config.brand.name} (na prośbę ${interaction.user.id})` });
    return interaction.editReply({ embeds: [embed(COLORS.brand).setTitle('😀 Emotki').setDescription(describeEmojiResult(res))] });
  } finally {
    running.delete(interaction.guild.id);
  }
}

async function runRepost(interaction) {
  if (!db.build(interaction.guild.id)) {
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription(`Ten serwer nie został jeszcze zbudowany – najpierw użyj \`${slash('build')}\`.`)], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  running.set(interaction.guild.id, { abort: false });
  try {
    const res = await refreshContent(interaction.guild);
    const desc =
      `Zaktualizowano na miejscu: **${res.edited}** ${plural(res.edited, 'wiadomość', 'wiadomości', 'wiadomości')}${res.sent ? `, ponownie wysłano brakujące: **${res.sent}**` : ''} – na **${res.channels}** ${plural(res.channels, 'kanale', 'kanałach', 'kanałach')}.` +
      (res.errors.length ? `\n\n⚠️ ${res.errors.slice(0, 5).join('\n')}` : '');
    return interaction.editReply({ embeds: [embed(res.errors.length ? COLORS.warning : COLORS.success).setTitle('🔄 Panele odświeżone').setDescription(desc)] });
  } finally {
    running.delete(interaction.guild.id);
  }
}

/** After a bot update: new channels/roles, name style, panels – one command. */
async function runUpdate(interaction) {
  const { guild } = interaction;
  if (!db.build(guild.id)) {
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription(`Ten serwer nie został jeszcze zbudowany – najpierw użyj \`${slash('build')}\`.`)], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  running.set(guild.id, { abort: false });
  try {
    const reason = `Aktualizacja ${config.brand.name} (na prośbę ${interaction.user.id})`;
    const added = await addMissing(guild, { reason });
    const removed = await removeRetired(guild, { reason, keepChannelId: interaction.channelId });
    const names = await restyleNames(guild);
    const panels = await refreshContent(guild);
    await require('../features/stats').updateStatChannels(guild.client).catch(() => null);
    const created = [...added.categories.map((n) => `📁 ${n}`), ...added.channels.map((n) => `# ${n}`), ...added.roles.map((n) => `🎭 ${n}`)];
    const restyled = added.restyled ?? [];
    const gone = [...removed.channels.map((n) => `# ${n}`), ...removed.categories.map((n) => `📁 ${n}`), ...removed.roles.map((n) => `🎭 ${n}`)];
    const errors = [...added.errors, ...removed.errors, ...names.errors, ...panels.errors];
    const lines = [
      created.length ? `**Nowe:**\n${created.slice(0, 20).join('\n')}${created.length > 20 ? `\n…i jeszcze ${created.length - 20}` : ''}` : '**Nowe:** nic – serwer ma już wszystkie kanały i role.',
      gone.length ? `**Usunięte (nie są już częścią serwera):**\n${gone.slice(0, 20).join('\n')}${gone.length > 20 ? `\n…i jeszcze ${gone.length - 20}` : ''}` : null,
      restyled.length ? `**Role z nową nazwą / kolorem:** ${restyled.slice(0, 20).join(', ')}${restyled.length > 20 ? ` …i jeszcze ${restyled.length - 20}` : ''}` : null,
      `**Nazwy:** zmienione: ${names.renamed}${names.later.length ? ` · ⏳ czekające na limit Discorda: ${names.later.length} – użyj \`${slash('build')} tylko:names\` za 10 minut` : ''}`,
      `**Panele:** zaktualizowane: ${panels.edited}${panels.sent ? ` · wysłane ponownie: ${panels.sent}` : ''}`,
    ];
    if (errors.length) lines.push(`⚠️ ${errors.slice(0, 5).join('\n')}`);
    return interaction.editReply({ embeds: [embed(errors.length ? COLORS.warning : COLORS.success).setTitle('🆕 Serwer zaktualizowany').setDescription(truncate(lines.filter(Boolean).join('\n\n'), 4000))] });
  } finally {
    running.delete(guild.id);
  }
}

async function runNames(interaction) {
  if (!db.build(interaction.guild.id)) {
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription(`Ten serwer nie został jeszcze zbudowany – najpierw użyj \`${slash('build')}\`.`)], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  running.set(interaction.guild.id, { abort: false });
  let last = 0;
  try {
    const res = await restyleNames(interaction.guild, {
      onProgress: (done, total) => {
        if (Date.now() - last < 2500 || done === total) return;
        last = Date.now();
        interaction.editReply({ embeds: [embed(COLORS.brand).setDescription(`🎨 Zmieniam nazwy… **${done}/${total}**`)] }).catch(() => null);
      },
    });
    const lines = [`Zmienione nazwy kanałów i kategorii: **${res.renamed}**${res.unchanged ? ` · z poprawną nazwą już wcześniej: **${res.unchanged}**` : ''}.`];
    if (res.later.length) lines.push(`⏳ Limit Discorda (2 zmiany nazwy na 10 minut) zatrzymał: **${res.later.length}** – za 10 minut użyj ponownie \`${slash('build')} tylko:names\`.`);
    if (res.errors.length) lines.push(`⚠️ ${res.errors.slice(0, 5).join('\n')}`);
    const ok = !res.later.length && !res.errors.length;
    return interaction.editReply({ embeds: [embed(ok ? COLORS.success : COLORS.warning).setTitle('🎨 Nazwy kanałów zaktualizowane').setDescription(lines.join('\n\n'))] });
  } finally {
    running.delete(interaction.guild.id);
  }
}

function wipeModal(guild) {
  return new ModalBuilder()
    .setCustomId('build:wipeconfirm')
    .setTitle('⚠️ Wyczyść i zbuduj')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Wpisz nazwę serwera, żeby potwierdzić')
        .setDescription(truncate(`Usuniemy wszystkie kanały, role i reguły AutoMod. Nazwa serwera: ${guild.name}`, 100))
        .setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder(truncate(guild.name, 100))),
    );
}

async function run(interaction, mode) {
  const { guild } = interaction;
  if (running.has(guild.id)) {
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription('⏳ Na tym serwerze trwa już budowa.')], flags: MessageFlags.Ephemeral });
  }
  const state = { abort: false };
  running.set(guild.id, state);
  const originChannelId = interaction.channelId;
  let lastEdit = 0;
  let editsWork = true;

  const push = async (payload) => {
    if (!editsWork) return;
    await interaction.editReply(payload).catch(() => {
      editsWork = false; // the 15-minute interaction window ran out – the build continues anyway
    });
  };

  await interaction.update(progressCard(guild, { done: 0, total: 1, phase: 'Przygotowanie', label: '', elapsed: 0 }));
  try {
    const R = await buildServer({
      guild,
      mode,
      invokerId: interaction.user.id,
      keepChannelIds: mode === 'wipe' ? [originChannelId] : [],
      shouldAbort: () => state.abort,
      onProgress: (s) => {
        const now = Date.now();
        if (now - lastEdit < 1500) return;
        lastEdit = now;
        push(progressCard(guild, s, { finishedPhases: s.phases }));
      },
    });
    await push(resultCard(guild, R, { originChannelId, wipe: mode === 'wipe' }));
    if (!editsWork) {
      await interaction.user.send({ embeds: [embed(COLORS.brand).setTitle(`Budowa ${config.brand.name} zakończona`).setDescription(`Utworzono ${count(R.created.channels, 'kanał', 'kanały', 'kanałów')} i ${count(R.created.roles, 'rolę', 'role', 'ról')} w ${duration(R.duration)}.`)] }).catch(() => null);
    }
    return R;
  } finally {
    running.delete(guild.id);
  }
}

async function handle(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  const { guild, member } = interaction;
  const deny = (msg) => interaction.reply({ embeds: [embed(COLORS.danger).setDescription(msg)], flags: MessageFlags.Ephemeral });

  if (action === 'stop') {
    const state = running.get(guild.id);
    if (!state) return deny('Nie trwa żadna budowa.');
    if (!canBuild(member)) return deny('Tylko administratorzy mogą zatrzymać budowę.');
    state.abort = true;
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription('⏹️ Zatrzymuję po bieżącym kroku…')], flags: MessageFlags.Ephemeral });
  }
  if (action === 'delorigin') {
    if (!isOwner(member)) return deny('Tylko właściciel serwera może to zrobić.');
    const channel = guild.channels.cache.get(arg);
    await interaction.update({ components: [container(COLORS.muted).addTextDisplayComponents(text('🗑️ Usuwam ten kanał…'))], flags: MessageFlags.IsComponentsV2, attachments: [] }).catch(() => null);
    await channel?.delete(`Stary kanał usunięty po ${slash('build')}`).catch(() => null);
    return null;
  }
  if (!canBuild(member)) return deny(`Z komendy \`${slash('build')}\` mogą korzystać tylko właściciel serwera i administratorzy.`);

  switch (action) {
    case 'cancel':
      return interaction.update({ components: [container(COLORS.muted).addTextDisplayComponents(text('✖️ Budowa anulowana – nic nie zostało zmienione.'))], flags: MessageFlags.IsComponentsV2, attachments: [] });
    case 'go':
      return run(interaction, 'add');
    case 'wipe':
      if (!isOwner(member)) return deny('🔒 Tylko właściciel serwera może wyczyścić serwer.');
      return interaction.showModal(wipeModal(guild));
    case 'wipeconfirm': {
      if (!isOwner(member)) return deny('🔒 Tylko właściciel serwera może wyczyścić serwer.');
      const typed = interaction.fields.getTextInputValue('name').trim().toLowerCase();
      if (typed !== guild.name.trim().toLowerCase()) return deny('❌ Nazwa się nie zgadza – nic nie zostało usunięte.');
      return run(interaction, 'wipe');
    }
    default:
      return null;
  }
}

module.exports = { start, handle, previewCard, progressCard, resultCard, running };
