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
const panels = require('../lib/panels');
const { e, ce, emojiId, COLORS } = require('../lib/theme');
const { UserError, embed, ts, truncate, sendToChannel } = require('../lib/utils');
const { container, text, divider, btn, row, section, gallery, header, v2, linkBtn } = require('../lib/v2');

const RATING_LABELS = { 5: 'Excellent', 4: 'Good', 3: 'Okay', 2: 'Poor', 1: 'Bad' };

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
    `# ${e(guild, 'star')} Vouches\nBought something from **${config.brand.name}**? Tell everyone how it went – ` +
      'your vouch helps others shop with confidence. 💜',
    guild.iconURL?.({ size: 256 }),
  );
  c.addSeparatorComponents(divider());
  if (s.count) {
    c.addTextDisplayComponents(
      text(
        `### ${s.avg.toFixed(2)} / 5${' '}·${' '}${s.count} ${s.count === 1 ? 'vouch' : 'vouches'}\n` +
          s.dist.map(([n, k]) => `${n}⭐ ${bar(k, s.count)} ${k}`).join('\n'),
      ),
    );
  } else {
    c.addTextDisplayComponents(text(`### ${e(guild, 'sparkles')} Be the first!\nNo vouches yet – after your first order, leave one here.`));
  }
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text('-# Click the button below or use `/vouch` anywhere. One vouch per order, please – fake vouches are removed.'));
  c.addActionRowComponents(row(btn('vouch:open', 'Leave a vouch', ce(guild, 'star'), ButtonStyle.Success)));
  return v2(c);
}

panels.register('vouches', (guild) => vouchPanel(guild));

function checkCanVouch(member) {
  const cfg = config.vouches;
  const customer = db.roleId(member.guild.id, 'customer');
  if (cfg.requireCustomerRole && customer && !member.roles.cache.has(customer)) {
    throw new UserError('Only customers can leave vouches. You get the **Customer** role automatically after your first completed order.');
  }
  const hours = Number(cfg.cooldownHours) || 0;
  const last = db.guild(member.guild.id).vouchCooldowns[member.id];
  if (hours > 0 && last && Date.now() - last < hours * 3_600_000) {
    throw new UserError(`You've already left a vouch recently – you can leave another one ${ts(last + hours * 3_600_000, 'R')}.`);
  }
  if (!db.channelId(member.guild.id, 'vouches')) throw new UserError('The vouches channel is not set up yet. Ask an admin to run `/build`.');
}

/** customId / productId: used by the vouch request in DMs (src/features/orders.js) – productId preselects the product. */
function vouchModal(guild, { customId = 'vouch:submit', productId = null } = {}) {
  const products = db.guild(guild.id).products;
  const modal = new ModalBuilder().setCustomId(customId).setTitle(`${config.brand.name} · Leave a vouch`.slice(0, 45));
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Your rating')
      .setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('rating')
          .setPlaceholder('How was your experience?')
          .addOptions([5, 4, 3, 2, 1].map((n) => ({ label: `${'⭐'.repeat(n)}  ${RATING_LABELS[n]}`, value: String(n) }))),
      ),
  );
  if (products.length) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('What did you buy?')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('product')
            .setPlaceholder('Choose a product…')
            .addOptions([
              ...products.slice(0, 24).map((p) => ({ label: truncate(p.name, 100), value: p.id, default: p.id === productId })),
              { label: 'Something else', value: '__other', emoji: '✨' },
            ]),
        ),
    );
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Product name (if "Something else")')
        .setTextInputComponent(new TextInputBuilder().setCustomId('product_other').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)),
    );
  } else {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('What did you buy?')
        .setTextInputComponent(new TextInputBuilder().setCustomId('product_other').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
    );
  }
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Your review')
      .setDescription('Delivery speed, quality, support – anything that helps others.')
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
  if (!String(attachment.contentType ?? '').startsWith('image/')) throw new UserError('The proof must be an image (PNG, JPG, GIF or WEBP).');
  if (attachment.size > 8 * 1024 * 1024) throw new UserError('The image is too big (max 8 MB).');
  const res = await fetch(attachment.url);
  if (!res.ok) throw new UserError('I could not download your image – try again.');
  const ext = (attachment.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  return { buffer: Buffer.from(await res.arrayBuffer()), ext };
}

async function postVouch(guild, member, { rating, product, review, image = null }) {
  checkCanVouch(member);
  const r = Math.max(1, Math.min(5, Number(rating) || 5));
  const clean = String(review ?? '').trim();
  if (clean.length < (Number(config.vouches.minLength) || 10)) throw new UserError(`Please write a bit more (at least ${config.vouches.minLength || 10} characters).`);

  const g = db.guild(guild.id);
  const n = g.vouches.length + 1;
  const c = container(r >= 4 ? COLORS.brand : r === 3 ? COLORS.warning : COLORS.danger);
  c.addSectionComponents(
    section(`## ${stars(guild, r)}\n### Vouch #${n}${' '}·${' '}${RATING_LABELS[r]}\n>>> ${truncate(clean, 1500)}`, member.displayAvatarURL?.({ size: 128 })),
  );
  const files = [];
  if (image) {
    const name = `vouch-${n}.${image.ext}`;
    files.push(new AttachmentBuilder(image.buffer, { name }));
    c.addMediaGalleryComponents(gallery(`attachment://${name}`));
  }
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`${e(guild, 'box')} **Product:** ${truncate(product || '—', 100)}\n-# Vouched by ${member} · ${ts(Date.now(), 'f')}`));

  const message = await sendToChannel(guild, db.channelId(guild.id, 'vouches'), v2(c, { files }));
  if (!message) throw new UserError('I could not post your vouch – please tell the staff.');
  g.vouches.push({ n, userId: member.id, rating: r, product: truncate(product || '', 100), review: truncate(clean, 500), at: Date.now(), messageId: message.id });
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
  try {
    const [id] = interaction.fields.getStringSelectValues('product');
    const p = db.guild(guild.id).products.find((x) => x.id === id);
    if (p) product = p.name;
  } catch {
    // no product select in this modal
  }
  if (!product) throw new UserError('Please tell us which product you bought.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { n, message } = await postVouch(guild, member, { rating, product, review: read('review') });
  return thanks(interaction, n, message);
}

function thanks(interaction, n, message) {
  return interaction.editReply({
    embeds: [embed(COLORS.success).setTitle('💜 Thank you for your vouch!').setDescription(`Your vouch **#${n}** is live. It really helps us grow!`)],
    components: [row(linkBtn(message.url, 'View vouch', '⭐'))],
  });
}

module.exports = { stars, stats, vouchPanel, vouchModal, openModal, submitModal, postVouch, fetchImage, thanks, checkCanVouch };
