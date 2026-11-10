'use strict';

/**
 * The HammerShop community inside the launcher:
 *  - the Discord server – name, icon, banner, members and how many are online, from Discord's public invite API
 *    (no bot token needed),
 *  - the newest products of the HammerShop store – from the bot's website (GET /api/shop/store).
 * The invite comes from launcher.config.json ("discordInvite") or, when that is empty, from the website, which
 * shares the invite the bot created with /zbuduj – so the launcher follows the bot without a new release.
 */

const UA = 'Hammer-Launcher/1.0 (hammershop.pl)';
const TTL = 3 * 60 * 1000;

/** "https://discord.gg/abc", "discord.com/invite/abc" or "abc" → "abc". */
function inviteCode(value) {
  const s = String(value ?? '').trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]{2,64})\/?(?:\?.*)?$/i.exec(s) ?? /^([\w-]{2,64})$/.exec(s);
  return m ? m[1] : null;
}

const cdn = (kind, id, hash, size) => (id && hash ? `https://cdn.discordapp.com/${kind}/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=${size}` : null);

function createCommunity({ config, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
  const cache = new Map();

  /** Cached for a few minutes; when a refresh fails the last good value is kept. */
  async function cached(key, fn, ttl = TTL) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    try {
      const value = await fn();
      cache.set(key, { at: now(), value });
      return value;
    } catch (err) {
      if (hit) return hit.value;
      throw err;
    }
  }

  async function getJson(url) {
    const res = await fetchFn(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.json();
  }

  const apiBase = () => String(config.shopApi || config.website || '').replace(/\/+$/, '');

  /** The bot website's store: { products, discordUrl, currency }. */
  function store() {
    const base = apiBase();
    if (!/^https?:\/\//.test(base)) return Promise.resolve(null);
    return cached('store', () => getJson(`${base}/api/shop/store`));
  }

  async function invite() {
    const own = inviteCode(config.discordInvite);
    if (own) return own;
    try {
      return inviteCode((await store())?.discordUrl);
    } catch {
      return null;
    }
  }

  /**
   * The Discord server card: { code, url, name, description, iconUrl, bannerUrl, members, online, live }.
   * null when no invite is set anywhere. When Discord can't be reached, the card still has the join link (live: false).
   */
  async function discord() {
    const code = await invite();
    if (!code) return null;
    const url = `https://discord.gg/${code}`;
    try {
      return await cached(`discord:${code}`, async () => {
        const d = await getJson(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`);
        const g = d.guild ?? {};
        return {
          code,
          url,
          name: g.name ?? config.brand ?? 'Discord',
          description: g.description ?? null,
          iconUrl: cdn('icons', g.id, g.icon, 128),
          bannerUrl: cdn('banners', g.id, g.banner, 600) ?? cdn('splashes', g.id, g.splash, 600),
          members: Number.isFinite(d.approximate_member_count) ? d.approximate_member_count : null,
          online: Number.isFinite(d.approximate_presence_count) ? d.approximate_presence_count : null,
          expiresAt: d.expires_at ?? null,
          live: true,
        };
      });
    } catch (err) {
      // 404 = the invite expired or was deleted – say so, so the owner can fix the config.
      return { code, url, name: config.brand ?? 'Discord', description: null, iconUrl: null, bannerUrl: null, members: null, online: null, live: false, invalid: err.status === 404 };
    }
  }

  /** Newest store products for the home screen: { url, currency, products: [{ id, name, category, description, price, image, instant }] }. */
  async function shop({ limit = 4 } = {}) {
    const base = apiBase();
    const url = config.shopUrl || base || null;
    let s = null;
    try {
      s = await store();
    } catch {
      s = null;
    }
    const products = (s?.products ?? [])
      .filter((p) => p && p.name && Number.isFinite(Number(p.price)))
      .slice(0, Math.max(1, Math.min(12, limit)))
      .map((p) => ({
        id: String(p.id),
        name: String(p.name).slice(0, 80),
        category: p.category ? String(p.category).slice(0, 40) : null,
        description: p.description ? String(p.description).replace(/\s+/g, ' ').slice(0, 140) : '',
        price: Number(p.price) / 100, // the API counts in cents / grosze
        image: typeof p.image === 'string' ? (/^https:\/\//.test(p.image) ? p.image : p.image.startsWith('/') && /^https:\/\//.test(base) ? `${base}${p.image}` : null) : null,
        instant: Boolean(p.instant),
      }));
    return { url, currency: typeof s?.currency === 'string' ? s.currency.toUpperCase() : null, products };
  }

  return { discord, shop, invite };
}

module.exports = { createCommunity, inviteCode };
