'use strict';

/**
 * Shop open / closed. Automatic from config.json → workingHours (e.g. open 10:00–20:00 every day),
 * or set by hand with /shop open | /shop close (until /shop auto). Shown as the locked voice channel
 * "🟢┃ꜱʜᴏᴘ ᴏᴘᴇɴ" / "🔴┃ꜱʜᴏᴘ ᴄʟᴏꜱᴇᴅ" at the top of the server.
 */

const config = require('../lib/config');
const db = require('../lib/db');
const { workingStatus } = require('../lib/utils');
const { channelName } = require('../builder/style');

/** 'auto' (follows workingHours) | 'open' | 'closed' (set by hand). */
const mode = (guildId) => db.guild(guildId).shopStatus.mode ?? 'auto';

function isOpen(guildId, now = new Date()) {
  const m = mode(guildId);
  if (m === 'open') return true;
  if (m === 'closed') return false;
  return workingStatus(now).open;
}

/** Name of the status channel right now (null when the feature is off). */
function statusChannelName(guildId, now = new Date()) {
  if (!config.shopStatus.enabled) return null;
  return channelName(isOpen(guildId, now) ? config.shopStatus.openName : config.shopStatus.closedName);
}

module.exports = { mode, isOpen, statusChannelName };
