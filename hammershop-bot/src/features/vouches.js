'use strict';

const {
  AttachmentBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const panels = require('../lib/panels');
const lockdown = require('./lockdown');
const { e, ce, emojiId, COLORS } = require('../lib/theme');
const { UserError, embed, ts, truncate, sendToChannel, count } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');
const { container, text, divider, btn, row, section, gallery, header, v2, linkBtn } = require('../lib/v2');

const RATING_LABELS = { 5: 'Świetnie', 4: 'Dobrze', 3: 'W porządku', 2: 'Słabo', 1: 'Źle' };

/** ⭐⭐⭐☆☆ – custom stars only when both are uploaded, so full and empty stars never look the same. */
function stars(guild, n) {
  if (emojiId(guild, 'star') && emojiId(guild, 'star_outline')) return `${e(guild, 'star').repeat(n)}${e(guild, 'star_outline').repeat(5 - n)}`;
  return `${'⭐'.repeat(n)}${'☆'.repeat(5 - n)}`;
}

function stats(guildId) {
  const list = db.guild(guildId).vouches;
  const avg = list.length ? list.reduce((a, v) => a + v.rating, 0) / list.length : null;
  const dist = [5, 4, 3, 2, 1].map((n) => [n, list.filter((v) => v.rating === n).length]);
  return { count: list.length, avg, dist };
}

const bar = (n, total, width = 12) => {
  const filled = total ? Math.round((n / total) * width) : 0;
  return `\`${'█'.repeat(filled)}${'░'.repeat(width - filled)}\``;
};

/** The live panel at the top of #vouches. */
function vouchPanel(guild) {
  const s = stats(guild.id);
  const c = container(COLORS.brand);
  header(
    c,
    `# ${e(guild, 'star')} Opinie\nMasz za sobą zakup w **${config.brand.name}**? Napisz wszystkim, jak poszło – ` +
      'Twoja opinia pomaga innym kupować z zaufaniem. 🧡',
    guild.iconURL?.({ size: 256 }),
  );
  c.addSeparatorComponents(divider());
  if (s.count) {
    c.addTextDisplayComponents(
      text(
        `### ${s.avg.toFixed(2)} / 5${' '}·${' '}${count(s.count, 'opinia', 'opinie', 'opinii')}\n` +
          s.dist.map(([n, k]) => `${n}⭐ ${bar(k, s.count)} ${k}`).join('\n'),
      ),
    );
  } else {
    c.addTextDisplayComponents(text(`### ${e(guild, 'sparkles')} Zostaw pierwszą opinię!\nNie ma jeszcze żadnych opinii – po pierwszym zamówieniu wystaw ją tutaj.`));
  }
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`-# Kliknij przycisk poniżej albo użyj \`${slash('vouch')}\` na dowolnym kanale. Jedna opinia na zamówienie – fałszywe opinie są usuwane.`));
  c.addActionRowComponents(row(btn('vouch:open', 'Wystaw opinię', ce(guild, 'star'), ButtonStyle.Success)));
  return v2(c);
}

panels.register('vouches', (guild) => vouchPanel(guild));

function checkCanVouch(member) {
  if (lockdown.pausedFor(member)) throw new UserError('Serwer jest teraz zablokowany – opinie są wstrzymane do czasu odblokowania. Spróbuj ponownie później 🧡');
  const cfg = config.vouches;
  const customer = db.roleId(member.guild.id, 'customer');
  if (cfg.requireCustomerRole && customer && !member.roles.cache.has(customer)) {
    throw new UserError('Opinie mogą wystawiać tylko klienci. Rolę **Klient** dostajesz automatycznie po pierwszym zrealizowanym zamówieniu.');
  }
  const hours = Number(cfg.cooldownHours) || 0;
  const last = db.guild(member.guild.id).vouchCooldowns[member.id];
  if (hours > 0 && last && Date.now() - last < hours * 3_600_000) {
    throw new UserError(`Masz już niedawno wystawioną opinię – kolejną możesz dodać ${ts(last + hours * 3_600_000, 'R')}.`);
  }
  if (!db.channelId(member.guild.id, 'vouches')) throw new UserError(`Kanał z opiniami nie jest jeszcze gotowy. Poproś administratora o użycie \`${slash('build')}\`.`);
}

/** customId / productId: used by the vouch request in DMs (src/features/orders.js) – productId preselects the product. */
function vouchModal(guild, { customId = 'vouch:submit', productId = null } = {}) {
  const products = db.guild(guild.id).products;
  const modal = new ModalBuilder().setCustomId(customId).setTitle(`${config.brand.name} · Wystaw opinię`.slice(0, 45));
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Twoja ocena')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('rating')
          .setPlaceholder('Jak oceniasz zakup?')
          .addOptions([5, 4, 3, 2, 1].map((n) => ({ label: `${'⭐'.repeat(n)}  ${RATING_LABELS[n]}`, value: String(n) }))),
      ),
  );
  if (products.length) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Kupiony produkt')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('product')
            .setPlaceholder('Wybierz produkt…')
            .addOptions([
              // The bought product first, then the newest ones (a menu holds 25 options).
              ...[products.find((p) => p.id === productId), ...[...products].reverse().filter((p) => p.id !== productId)]
                .filter(Boolean)
                .slice(0, 24)
                .map((p) => ({ label: truncate(p.name, 100), value: p.id, default: p.id === productId })),
              { label: 'Coś innego', value: '__other', emoji: '✨' },
            ]),
        ),
    );
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Nazwa produktu (jeśli „Coś innego”)')
        .setTextInputComponent(new TextInputBuilder().setCustomId('product_other').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)),
    );
  } else {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Kupiony produkt')
        .setTextInputComponent(new TextInputBuilder().setCustomId('product_other').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
    );
  }
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Twoja opinia')
      .setDescription('Szybkość dostawy, jakość, obsługa – wszystko, co pomoże innym.')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('review')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(Math.min(Number(config.vouches.minLength) || 10, 100))
          .setMaxLength(800),
      ),
  );
  return modal;
}

async function openModal(interaction) {
  checkCanVouch(interaction.member);
  return interaction.showModal(vouchModal(interaction.guild));
}

async function fetchImage(attachment) {
  if (!attachment?.url) return null;
  if (!String(attachment.contentType ?? '').startsWith('image/')) throw new UserError('Zrzut ekranu musi być obrazem (PNG, JPG, GIF lub WEBP).');
  if (attachment.size > 8 * 1024 * 1024) throw new UserError('Obraz jest za duży (maks. 8 MB).');
  const res = await fetch(attachment.url);
  if (!res.ok) throw new UserError('Nie udało mi się pobrać Twojego obrazu – spróbuj ponownie.');
  const ext = (attachment.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  return { buffer: Buffer.from(await res.arrayBuffer()), ext };
}

/** productId: the catalog product picked in the vouch form – a typed name (/vouch) is matched to the catalog by name. */
async function postVouch(guild, member, { rating, product, productId = null, review, image = null }) {
  checkCanVouch(member);
  const r = Math.max(1, Math.min(5, Number(rating) || 5));
  const clean = String(review ?? '').trim();
  if (clean.length < (Number(config.vouches.minLength) || 10)) throw new UserError(`Napisz trochę więcej (co najmniej ${count(Number(config.vouches.minLength) || 10, 'znak', 'znaki', 'znaków')}).`);

  const g = db.guild(guild.id);
  // Reserved before the first await, so two vouches at the same moment never share a number.
  g.vouchSeq = Math.max(Number(g.vouchSeq) || 0, g.vouches.length, ...g.vouches.map((v) => Number(v.n) || 0)) + 1;
  const n = g.vouchSeq;
  const c = container(r >= 4 ? COLORS.brand : r === 3 ? COLORS.warning : COLORS.danger);
  c.addSectionComponents(
    section(`## ${stars(guild, r)}\n### Opinia #${n}${' '}·${' '}${RATING_LABELS[r]}\n>>> ${truncate(clean, 1500)}`, member.displayAvatarURL?.({ size: 128 })),
  );
  const files = [];
  if (image) {
    const name = `vouch-${n}.${image.ext}`;
    files.push(new AttachmentBuilder(image.buffer, { name }));
    c.addMediaGalleryComponents(gallery(`attachment://${name}`));
  }
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`${e(guild, 'box')} **Produkt:** ${truncate(product || '—', 100)}\n-# Opinia od ${member} · ${ts(Date.now(), 'f')}`));

  const message = await sendToChannel(guild, db.channelId(guild.id, 'vouches'), v2(c, { files }));
  if (!message) throw new UserError('Nie udało mi się opublikować Twojej opinii – daj znać zespołowi.');
  // The product's ID too, for the ⭐ rating badge in the shop (features/badges.js).
  const name = String(product ?? '').trim().toLowerCase();
  const id = productId ?? g.products.find((p) => name && p.name.toLowerCase() === name)?.id ?? null;
  g.vouches.push({ n, userId: member.id, rating: r, product: truncate(product || '', 100), productId: id, review: truncate(clean, 500), at: Date.now(), messageId: message.id });
  g.vouchCooldowns[member.id] = Date.now();
  db.save();
  // Keep the "Leave a vouch" panel as the newest message, so it's always the first thing people see.
  if (config.vouches.stickyPanel !== false) await panels.bump(guild, 'vouches', message.channelId ?? message.channel?.id);
  panels.schedule(guild, 'vouches');
  panels.schedule(guild, 'shop');
  return { n, message };
}

/** guild / member are passed in for forms sent from DMs (interaction.guild is null there). */
async function submitModal(interaction, guild = interaction.guild, member = interaction.member) {
  const read = (id) => {
    try {
      return interaction.fields.getTextInputValue(id)?.trim() ?? '';
    } catch {
      return '';
    }
  };
  let rating = 5;
  try {
    rating = Number(interaction.fields.getStringSelectValues('rating')[0]) || 5;
  } catch {
    // keep default
  }
  let product = read('product_other');
  let productId = null;
  try {
    const [id] = interaction.fields.getStringSelectValues('product');
    const p = db.guild(guild.id).products.find((x) => x.id === id);
    if (p) [product, productId] = [p.name, p.id];
  } catch {
    // no product select in this modal
  }
  if (!product) throw new UserError('Podaj nazwę kupionego produktu.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { n, message } = await postVouch(guild, member, { rating, product, productId, review: read('review') });
  return thanks(interaction, n, message);
}

function thanks(interaction, n, message) {
  return interaction.editReply({
    embeds: [embed(COLORS.success).setTitle('🧡 Dziękujemy za opinię!').setDescription(`Twoja opinia **#${n}** jest już widoczna. To naprawdę pomaga nam się rozwijać!`)],
    components: [row(linkBtn(message.url, 'Zobacz opinię', '⭐'))],
  });
}

/** A vouch message deleted by the team (fake or spam vouch): take it out of the counters and averages too. */
function onMessageDelete(message) {
  const guild = message?.guild;
  if (!guild) return false;
  const g = db.guild(guild.id);
  const i = g.vouches.findIndex((v) => v.messageId === message.id);
  if (i === -1) return false;
  g.vouches.splice(i, 1);
  db.save();
  panels.schedule(guild, 'vouches');
  panels.schedule(guild, 'shop');
  return true;
}
hooks.on('messageDelete', onMessageDelete);

module.exports = { onMessageDelete, stars, stats, vouchPanel, vouchModal, openModal, submitModal, postVouch, fetchImage, thanks, checkCanVouch };
