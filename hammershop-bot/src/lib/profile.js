'use strict';

/**
 * Which server this copy of the bot runs – BOT_PROFILE in .env:
 *
 *   shop      (default) HammerShop: the shop server – products, orders, payments, vouches.
 *   launcher  Hammer Launcher: the launcher's own community – download, new versions, news, Hammer+, bug reports
 *             and ideas. The same engine (tickets, verification, giveaways, logs, the website and its admin panel)
 *             and the same emojis, with its own name, logo (the big H), banners, channels, roles and rules; the
 *             shop's channels and commands are left out, and the website's front page is the launcher's page.
 *
 * What differs: config.launcher.json (laid over config.json – src/lib/config.js), src/builder/layout.launcher.js,
 * src/builder/content.launcher.js, assets/banners-launcher/ and regulamin-launcher.md.
 */

require('../env'); // .env is read before anyone asks which profile this is

const name = String(process.env.BOT_PROFILE ?? '').trim().toLowerCase() === 'launcher' ? 'launcher' : 'shop';

module.exports = { name, launcher: name === 'launcher', shop: name === 'shop' };
