'use strict';

/**
 * News on the home screen: a JSON list from launcher.config.json → newsUrl
 * ([{ title, body, date, image, url }]), or built-in tips when there is none or it can't be loaded.
 */

const BUILT_IN = [
  { title: 'Witaj w HammerShop Launcher!', body: 'Zaloguj się kontem Microsoft, wybierz instancję i kliknij GRAJ. Launcher sam pobierze grę, Javę i mody.', date: null, tag: 'Start' },
  { title: 'Jedno kliknięcie – więcej FPS', body: 'Zakładka Optymalizacja dobiera RAM, flagi Javy i mody wydajnościowe (Sodium, Lithium, FerriteCore…) pod Twoją wersję gry.', date: null, tag: 'Wydajność' },
  { title: 'Tysiące modów w zakładce Mody', body: 'Szukaj modów, paczek tekstur, shaderów i całych paczek modów z Modrinth – zależności instalują się same.', date: null, tag: 'Mody' },
];

function clean(item) {
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const url = typeof item.url === 'string' && /^https:\/\//.test(item.url) ? item.url : null;
  const image = typeof item.image === 'string' && /^https:\/\//.test(item.image) ? item.image : null;
  return { title: text(item.title, 120) ?? 'Aktualność', body: text(item.body, 600) ?? '', date: text(item.date, 40), tag: text(item.tag, 24), url, image };
}

async function loadNews(url, { fetchFn = (...a) => fetch(...a), timeout = 6000 } = {}) {
  if (!url) return BUILT_IN;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json' } });
    if (!res.ok) return BUILT_IN;
    const data = await res.json();
    const list = (Array.isArray(data) ? data : data?.news ?? []).slice(0, 12).map(clean);
    return list.length ? list : BUILT_IN;
  } catch {
    return BUILT_IN;
  }
}

module.exports = { loadNews, BUILT_IN };
