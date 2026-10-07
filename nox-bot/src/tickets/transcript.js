'use strict';

const { AttachmentBuilder } = require('discord.js');
const config = require('../lib/config');
const { maskPins } = require('../lib/utils');

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// PaysafeCard PINs (the "I've paid" card, or typed in the chat) never reach the archive in full – it's kept forever.
const textOf = (s) => esc(maskPins(s));

function formatContent(text, message) {
  let html = textOf(text);
  html = html.replace(/```(?:\w+\n)?([\s\S]*?)```/g, '<pre>$1</pre>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
    const u = message.mentions.users.get(id) ?? message.guild?.members.cache.get(id)?.user ?? message.client?.users.cache.get(id);
    const name = message.guild?.members.cache.get(id)?.displayName ?? u?.globalName ?? u?.username ?? id;
    return `<span class="mention">@${esc(name)}</span>`;
  });
  html = html.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
    const r = message.guild?.roles.cache.get(id);
    return `<span class="mention">@${esc(r?.name ?? id)}</span>`;
  });
  html = html.replace(/&lt;#(\d+)&gt;/g, (_, id) => {
    const c = message.guild?.channels.cache.get(id);
    return `<span class="mention">#${esc(c?.name ?? id)}</span>`;
  });
  return html.replace(/\n/g, '<br>');
}

function renderEmbed(e) {
  const color = e.hexColor ?? '#202225';
  const fields = (e.fields ?? [])
    .map((f) => `<div class="field${f.inline ? ' inline' : ''}"><div class="fname">${textOf(f.name)}</div><div>${textOf(f.value).replace(/\n/g, '<br>')}</div></div>`)
    .join('');
  return `<div class="embed" style="border-color:${esc(color)}">
    ${e.author?.name ? `<div class="eauthor">${textOf(e.author.name)}</div>` : ''}
    ${e.title ? `<div class="etitle">${textOf(e.title)}</div>` : ''}
    ${e.description ? `<div class="edesc">${textOf(e.description).replace(/\n/g, '<br>')}</div>` : ''}
    ${fields ? `<div class="fields">${fields}</div>` : ''}
    ${e.image?.url ? `<img class="eimg" src="${esc(e.image.url)}">` : ''}
    ${e.footer?.text ? `<div class="efooter">${textOf(e.footer.text)}</div>` : ''}
  </div>`;
}

/**
 * Discord attachment links expire after about a day and disappear with the ticket channel – so screenshots
 * and files (payment proof!) are copied into the transcript itself, up to 4 MB each and 6 MB in total
 * (the .html must stay under Discord's 10 MB upload limit). Bigger files keep their Discord link.
 */
const FILE_MAX = 4 * 1024 * 1024;
const TOTAL_MAX = 6 * 1024 * 1024;
async function inlineAttachments(messages) {
  const out = new Map();
  let total = 0;
  for (const m of messages) {
    for (const a of m.attachments?.values() ?? []) {
      if (!a.url || !(a.size > 0) || a.size > FILE_MAX || total + a.size > TOTAL_MAX) continue;
      try {
        const res = await fetch(a.url, { signal: globalThis.AbortSignal?.timeout?.(15_000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (total + buf.length > TOTAL_MAX) continue;
        total += buf.length;
        out.set(a.id ?? a.url, `data:${a.contentType || 'application/octet-stream'};base64,${buf.toString('base64')}`);
      } catch {
        // keep the Discord link for this one
      }
    }
  }
  return out;
}

function renderAttachment(a, src = a.url) {
  if (a.contentType?.startsWith('image/')) {
    return `<a href="${esc(src)}" target="_blank"><img class="att-img" src="${esc(src)}" alt="${esc(a.name)}"></a>`;
  }
  return `<a class="att-file" href="${esc(src)}" download="${esc(a.name)}" target="_blank">📎 ${esc(a.name)} <span>(${(a.size / 1024).toFixed(1)} KB)</span></a>`;
}

async function fetchAllMessages(channel) {
  const all = [];
  let before;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.reverse();
}

function componentText(components = []) {
  const out = [];
  const walk = (list) => {
    for (const c of list ?? []) {
      const data = c.data ?? c;
      if (data.type === 10 && data.content) out.push(data.content);
      if (c.components) walk(c.components);
    }
  };
  walk(components);
  return out.join('\n');
}

const TZ = { timeZone: config.workingHours?.timezone ?? 'UTC' };
const dayKey = (d) => d.toLocaleDateString('en-GB', TZ);
const time = (d) => d.toLocaleTimeString('en-GB', { ...TZ, hour: '2-digit', minute: '2-digit' });
const full = (d) => d.toLocaleString('en-GB', TZ);

function markdown(textRaw, message) {
  const line = (prefix, cls) => new RegExp(`(^|<br>)${prefix} (.*?)(?=<br>|$)`, 'g');
  return formatContent(textRaw, message)
    .replace(line('###', ''), '$1<span class="h3">$2</span>')
    .replace(line('##', ''), '$1<span class="h2">$2</span>')
    .replace(line('#', ''), '$1<span class="h1">$2</span>')
    .replace(line('-#', ''), '$1<span class="sub">$2</span>')
    .replace(line('&gt;', ''), '$1<span class="quote">$2</span>')
    .replace(/(<span class="(?:h1|h2|h3|sub|quote)">.*?<\/span>)<br>/g, '$1')
    .replace(/&lt;t:(\d+)(?::\w)?&gt;/g, (_, t) => `<span class="stamp">${esc(full(new Date(Number(t) * 1000)))}</span>`);
}

async function createTranscript(channel, ticket, type) {
  const messages = await fetchAllMessages(channel);
  const inlined = await inlineAttachments(messages);
  const guild = channel.guild;
  const participants = new Map();
  const byId = new Map(messages.map((m) => [m.id, m]));

  let lastAuthor = null;
  let lastTime = 0;
  let lastDay = null;
  const rows = [];

  for (const m of messages) {
    participants.set(m.author.id, (participants.get(m.author.id) ?? 0) + 1);
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      rows.push(`<div class="day"><span>${esc(m.createdAt.toLocaleDateString('en-GB', { ...TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span></div>`);
      lastDay = day;
      lastAuthor = null;
    }

    const member = guild.members.cache.get(m.author.id);
    const color = member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : '#f2f3f5';
    const name = member?.displayName ?? m.author.globalName ?? m.author.username;
    const isStaffMsg = m.author.id !== ticket.ownerId && !m.author.bot;
    const ref = m.reference?.messageId ? byId.get(m.reference.messageId) : null;
    const grouped = !ref && lastAuthor === m.author.id && m.createdTimestamp - lastTime < 7 * 60_000;
    lastAuthor = m.author.id;
    lastTime = m.createdTimestamp;

    const v2text = componentText(m.components);
    const body = [
      m.content ? `<div class="text">${markdown(m.content, m)}</div>` : '',
      v2text ? `<div class="card">${markdown(v2text, m)}</div>` : '',
      ...m.embeds.map(renderEmbed),
      ...[...m.attachments.values()].map((a) => renderAttachment(a, inlined.get(a.id ?? a.url))),
      ...[...(m.stickers?.values() ?? [])].map((st) => `<img class="sticker" src="${esc(st.url)}" alt="${esc(st.name)}" title="${esc(st.name)}">`),
    ].join('');

    const replyHtml = ref
      ? `<div class="reply">↪ <b>${esc(ref.member?.displayName ?? ref.author.username)}</b> ${textOf((ref.content || componentText(ref.components) || '📎 attachment').slice(0, 90))}</div>`
      : '';

    if (grouped) {
      rows.push(`<div class="msg cont" id="m${m.id}"><span class="side">${esc(time(m.createdAt))}</span><div class="content">${body}${m.editedAt ? '<span class="edited">(edited)</span>' : ''}</div></div>`);
    } else {
      const badge = m.author.bot ? '<span class="bot">BOT</span>' : m.author.id === ticket.ownerId ? '<span class="tag owner">AUTHOR</span>' : isStaffMsg ? '<span class="tag staff">SUPPORT</span>' : '';
      rows.push(`<div class="msg" id="m${m.id}">${replyHtml ? `<div class="replywrap">${replyHtml}</div>` : ''}
        <img class="avatar" src="${esc(m.author.displayAvatarURL({ size: 64, extension: 'png' }))}" alt="">
        <div class="content">
          <div class="head"><span class="author" style="color:${esc(color)}" title="${esc(m.author.tag)} · ${esc(m.author.id)}">${esc(name)}</span>${badge}<span class="time">${esc(full(m.createdAt))}</span></div>
          ${body}${m.editedAt ? '<span class="edited">(edited)</span>' : ''}
        </div>
      </div>`);
    }
  }

  const owner = await channel.client.users.fetch(ticket.ownerId).catch(() => null);
  const staffList = [...participants.keys()].filter((id) => id !== ticket.ownerId && !messages.find((m) => m.author.id === id)?.author.bot);
  const staffNames = staffList.map((id) => {
    const m = guild.members.cache.get(id);
    return esc(m?.displayName ?? messages.find((x) => x.author.id === id)?.author.username ?? id);
  });
  const answers = (ticket.answers ?? [])
    .map((a) => `<div class="qa"><div class="q">${esc(a.label)}</div><div class="a">${esc(a.value || '—').replace(/\n/g, '<br>')}</div></div>`)
    .join('');
  const stat = (label, value) => `<div class="stat"><div class="sl">${label}</div><div class="sv">${value}</div></div>`;
  const endTime = ticket.closedAt ?? Date.now();
  const durationText = (() => {
    const mins = Math.max(1, Math.round((endTime - ticket.createdAt) / 60000));
    return mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${Math.floor(mins / 1440)} d ${Math.floor((mins % 1440) / 60)} h`;
  })();

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transcript · #${esc(channel.name)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:15px/1.45 "gg sans","Segoe UI",Roboto,Arial,sans-serif}
a{color:#00a8fc;text-decoration:none}a:hover{text-decoration:underline}
header{background:linear-gradient(135deg,#1a1024,#2b2d31 60%,#2a1840);padding:28px 24px 20px;border-bottom:1px solid #1f2023}
.top{display:flex;gap:16px;align-items:center}.gicon{width:56px;height:56px;border-radius:16px;background:#a855f7;flex:none;object-fit:cover}
h1{margin:0;font-size:22px;color:#f2f3f5}.subtitle{color:#b5bac1;font-size:14px;margin-top:2px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:20px}
.stat{background:#1e1f22;border-radius:8px;padding:10px 14px}.sl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#949ba4;font-weight:700}.sv{color:#f2f3f5;font-weight:600;margin-top:2px;word-break:break-word}
.form{margin-top:16px;background:#1e1f22;border-radius:8px;padding:12px 14px;border-left:4px solid #a855f7}.form h2{margin:0 0 8px;font-size:13px;text-transform:uppercase;color:#949ba4;letter-spacing:.04em}
.qa{margin-top:8px}.q{font-weight:700;color:#f2f3f5;font-size:14px}.a{color:#dbdee1;font-size:14px}
main{padding:12px 0 24px}.day{display:flex;align-items:center;margin:18px 16px 8px;color:#949ba4;font-size:12px;font-weight:600}
.day:before,.day:after{content:"";flex:1;height:1px;background:#3f4147}.day span{padding:0 8px}
.msg{display:flex;flex-wrap:wrap;gap:0 16px;padding:4px 24px 4px 16px;margin-top:14px;position:relative}.msg.cont{margin-top:0;padding-top:1px;padding-bottom:1px}
.msg:hover{background:#2e3035}.msg:target{background:rgba(250,168,26,.1)}
.replywrap{flex-basis:100%;padding-left:56px;margin-bottom:2px}.reply{font-size:13px;color:#b5bac1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.reply b{color:#f2f3f5}
.avatar{width:40px;height:40px;border-radius:50%;flex:none;margin-top:2px}.side{width:40px;flex:none;font-size:10px;color:transparent;text-align:right;padding-top:4px}.msg.cont:hover .side{color:#949ba4}
.content{min-width:0;flex:1}.head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.author{font-weight:600;cursor:default}.bot,.tag{color:#fff;font-size:10px;padding:1px 5px;border-radius:4px;font-weight:700;letter-spacing:.02em}
.bot{background:#7c3aed}.tag.owner{background:#3ba55c}.tag.staff{background:#a855f7}
.time{color:#949ba4;font-size:12px;margin-left:2px}.edited{color:#949ba4;font-size:10px;margin-left:4px}
.text{word-wrap:break-word}
code{background:#2b2d31;padding:1px 4px;border-radius:3px;font-family:Consolas,monospace;font-size:13px}
pre{background:#2b2d31;border:1px solid #1e1f22;padding:8px;border-radius:4px;white-space:pre-wrap;font-family:Consolas,monospace;font-size:13px}
.mention{background:rgba(168,85,247,.3);color:#e9d5ff;padding:0 2px;border-radius:3px;font-weight:500}
.stamp{background:#2b2d31;padding:0 3px;border-radius:3px}
.h1{display:block;font-size:22px;font-weight:700;color:#f2f3f5;margin:4px 0}.h2{display:block;font-size:19px;font-weight:700;color:#f2f3f5;margin:4px 0}.h3{display:block;font-size:16px;font-weight:700;color:#f2f3f5;margin:2px 0}
.sub{display:block;font-size:12px;color:#949ba4}.quote{display:block;border-left:4px solid #4e5058;padding-left:10px}
.card{background:#2b2d31;border:1px solid #1e1f22;border-radius:8px;padding:12px 14px;margin-top:4px;max-width:620px}
.embed{background:#2b2d31;border-left:4px solid;border-radius:4px;padding:10px 14px;margin-top:6px;max-width:520px}
.etitle{font-weight:600;color:#f2f3f5;margin-bottom:4px}.eauthor{font-size:13px;font-weight:600;margin-bottom:4px}.edesc{font-size:14px}
.fields{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.field{flex:1 1 100%;font-size:14px}.field.inline{flex:1 1 30%}
.fname{font-weight:600;color:#f2f3f5}.efooter{font-size:12px;color:#949ba4;margin-top:8px}.eimg,.att-img{max-width:400px;max-height:300px;border-radius:6px;margin-top:6px;display:block}
.sticker{width:120px;height:120px;margin-top:4px}
.att-file{display:inline-block;margin-top:6px;background:#2b2d31;border:1px solid #1e1f22;padding:10px 14px;border-radius:6px}.att-file span{color:#949ba4;font-size:12px}
footer{text-align:center;color:#949ba4;font-size:12px;padding:20px;border-top:1px solid #3f4147}
@media(max-width:600px){.msg{padding:4px 12px}.eimg,.att-img{max-width:100%}}
</style></head><body>
<header>
  <div class="top">
    ${guild.iconURL() ? `<img class="gicon" src="${esc(guild.iconURL({ size: 128, extension: 'png' }))}" alt="">` : '<div class="gicon"></div>'}
    <div><h1>${esc(type?.emoji ?? '🎫')} ${esc(type?.label ?? 'Ticket')} · #${esc(String(ticket.number).padStart(4, '0'))}</h1>
    <div class="subtitle">${esc(guild.name)} · #${esc(channel.name)}</div></div>
  </div>
  <div class="stats">
    ${stat('Author', esc(owner?.tag ?? ticket.ownerId))}
    ${stat('Handled by', esc(staffNames.join(', ') || '—'))}
    ${stat('Opened', esc(full(new Date(ticket.createdAt))))}
    ${stat('Duration', esc(durationText))}
    ${stat('Messages', String(messages.length))}
    ${stat('Participants', String(participants.size))}
    ${ticket.closeReason ? stat('Close reason', esc(ticket.closeReason)) : ''}
  </div>
  ${answers ? `<div class="form"><h2>📝 Form</h2>${answers}</div>` : ''}
</header>
<main>${rows.join('\n')}</main>
<footer>Generated ${esc(full(new Date()))} · ${esc(guild.name)} · ${esc(config.brand.name)} ticket system</footer>
</body></html>`;

  const attachment = new AttachmentBuilder(Buffer.from(html, 'utf8'), {
    // From the ticket, not the channel name – styled names (🛒┃ᴏʀᴅᴇʀ-0001) have no ASCII letters left.
    name: `transcript-${String(type?.channelPrefix ?? 'ticket').replace(/[^\w-]/g, '') || 'ticket'}-${String(ticket.number ?? 0).padStart(4, '0')}.html`,
  });
  return { attachment, messageCount: messages.length, participants };
}

module.exports = { createTranscript };
