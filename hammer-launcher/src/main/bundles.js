'use strict';

/**
 * Zestawy modów – curated sets installed with one click (Mody → Zestawy). Every entry is a Modrinth slug, checked
 * against the real API; which ones exist for an instance is looked up per game version and loader, exactly like
 * the performance mods. Installing goes through the normal content install, so dependencies come along.
 *
 * What may be in a set: only things that do not give an advantage over other players. No minimap in the PvP set,
 * no freecam, x-ray, auto-clickers, "printer" add-ons or anything else servers commonly ban.
 */

const { resolveMods, visibleMods, installPlanned } = require('./optimizer');

const BUNDLES = [
  {
    id: 'pvp',
    name: 'PvP',
    icon: 'shield',
    description: 'Czytelna gra na serwerach: ping w tabeli, głowy graczy na czacie i obsługa paczek tekstur jak w OptiFine.',
    note: 'Tylko dodatki dozwolone na większości serwerów – żadnych cheatów ani ułatwień w walce.',
    items: [
      { slug: '3dskinlayers', name: '3D Skin Layers', why: 'Druga warstwa skórki (czapki, kurtki) jest wypukła.' },
      { slug: 'chat-heads', name: 'Chat Heads', why: 'Głowa gracza przy każdej wiadomości na czacie.' },
      { slug: 'better-ping-display-fabric', name: 'Better Ping Display', why: 'Ping w milisekundach na liście graczy (Tab).' },
      { slug: 'better-ping-display', name: 'Better Ping Display', why: 'Ping w milisekundach na liście graczy (Tab).', insteadOf: ['better-ping-display-fabric'] },
      { slug: 'entitytexturefeatures', name: 'Entity Texture Features', why: 'Tekstury mobów i graczy z paczek do OptiFine.' },
      { slug: 'entity-model-features', name: 'Entity Model Features', why: 'Własne modele z paczek tekstur do OptiFine.' },
      { slug: 'continuity', name: 'Continuity', why: 'Łączone tekstury (szkło bez ramek) z paczek tekstur.' },
      { slug: 'lambdynamiclights', name: 'LambDynamicLights', why: 'Pochodnia w ręce naprawdę świeci.' },
      { slug: 'shulkerboxtooltip', name: 'Shulker Box Tooltip', why: 'Podgląd zawartości shulkera po najechaniu myszką.' },
    ],
  },
  {
    id: 'survival',
    name: 'Survival+',
    icon: 'compass',
    description: 'Wszystko, czego brakuje w zwykłym survivalu: minimapa, mapa świata, receptury i wygodny ekwipunek.',
    note: 'Niektóre serwery nie pozwalają na minimapy – przed grą zerknij do regulaminu.',
    items: [
      { slug: 'xaeros-minimap', name: "Xaero's Minimap", why: 'Minimapa z punktami, do których chcesz wrócić.' },
      { slug: 'xaeros-world-map', name: "Xaero's World Map", why: 'Mapa całego odkrytego świata pod klawiszem M.' },
      { slug: 'jei', name: 'Just Enough Items', why: 'Wszystkie receptury i zastosowania przedmiotów.' },
      { slug: 'jade', name: 'Jade', why: 'Podpowiada, na jaki blok albo moba patrzysz.' },
      { slug: 'appleskin', name: 'AppleSkin', why: 'Pokazuje, ile głodu i nasycenia da jedzenie.' },
      { slug: 'mouse-tweaks', name: 'Mouse Tweaks', why: 'Przenoszenie przedmiotów przeciąganiem i kółkiem myszy.' },
      { slug: 'inventory-profiles-next', name: 'Inventory Profiles Next', why: 'Sortowanie ekwipunku i skrzyń jednym przyciskiem.' },
      { slug: 'enchantment-descriptions', name: 'Enchantment Descriptions', why: 'Opis każdego zaklęcia na przedmiocie.' },
      { slug: 'shulkerboxtooltip', name: 'Shulker Box Tooltip', why: 'Podgląd zawartości shulkera po najechaniu myszką.' },
    ],
  },
  {
    id: 'building',
    name: 'Budowanie',
    icon: 'bricks',
    description: 'Narzędzia budowniczego: szybkie kopiowanie i wypełnianie, schematy budowli i duże zrzuty ekranu.',
    note: 'WorldEdit i Axiom działają w grze jednoosobowej; na serwerze potrzebujesz uprawnień od administracji.',
    items: [
      { slug: 'worldedit', name: 'WorldEdit', why: 'Kopiowanie, wypełnianie i zamiana tysięcy bloków naraz.' },
      { slug: 'worldedit-cui', name: 'WorldEdit CUI', why: 'Pokazuje zaznaczony obszar WorldEdita liniami.' },
      { slug: 'axiom', name: 'Axiom', why: 'Edytor świata w grze: pędzle, kształty, płynne budowanie.' },
      { slug: 'litematica', name: 'Litematica', why: 'Wyświetla schemat budowli jako podpowiedź, gdzie stawiać bloki.' },
      { slug: 'fabrishot', name: 'Fabrishot', why: 'Zrzuty ekranu w ogromnej rozdzielczości (F9).' },
    ],
  },
  {
    id: 'shaders',
    name: 'Shadery',
    icon: 'sun',
    description: 'Iris i trzy lubiane paczki shaderów: cienie, falująca woda i ciepłe światło.',
    note: 'Shader wybierasz w grze: Opcje → Ustawienia graficzne → Paczki shaderów. Potrzebna jest dobra karta graficzna.',
    items: [
      { slug: 'iris', name: 'Iris Shaders', why: 'Obsługa shaderów – działa razem z Sodium.' },
      { slug: 'oculus', name: 'Oculus', why: 'Obsługa shaderów na Forge – razem z Embeddium.', insteadOf: ['iris'] },
      { slug: 'complementary-reimagined', name: 'Complementary Reimagined', why: 'Najpopularniejszy shader – ładny i w stylu Minecrafta.', type: 'shader' },
      { slug: 'bsl-shaders', name: 'BSL Shaders', why: 'Miękkie światło i filmowe kolory.', type: 'shader' },
      { slug: 'makeup-ultra-fast-shaders', name: 'MakeUp – Ultra Fast', why: 'Lekki shader dla słabszych kart graficznych.', type: 'shader' },
    ],
  },
  {
    id: 'visuals',
    name: 'Wygląd i klimat',
    icon: 'sparkles',
    description: 'Gra wygląda i brzmi ładniej bez shaderów: animacje postaci, spadające liście, odgłosy otoczenia.',
    note: 'Same ozdoby – nie zmieniają rozgrywki i działają na każdym serwerze.',
    items: [
      { slug: 'not-enough-animations', name: 'Not Enough Animations', why: 'Postać naprawdę je, trzyma mapę i wiosłuje.' },
      { slug: '3dskinlayers', name: '3D Skin Layers', why: 'Druga warstwa skórki (czapki, kurtki) jest wypukła.' },
      { slug: 'wavey-capes', name: 'Wavey Capes', why: 'Peleryna faluje na wietrze.' },
      { slug: 'visuality', name: 'Visuality', why: 'Drobne efekty: iskry, bąbelki, krople.' },
      { slug: 'fallingleaves', name: 'Falling Leaves', why: 'Z drzew spadają liście.' },
      { slug: 'particle-rain', name: 'Particle Rain', why: 'Deszcz, śnieg i burze piaskowe z prawdziwych kropel.' },
      { slug: 'ambientsounds', name: 'AmbientSounds', why: 'Odgłosy lasu, jaskiń i morza w tle.' },
      { slug: 'presence-footsteps', name: 'Presence Footsteps', why: 'Inny odgłos kroków na każdym podłożu.' },
      { slug: 'lambdynamiclights', name: 'LambDynamicLights', why: 'Pochodnia w ręce naprawdę świeci.' },
    ],
  },
];

const meta = (b) => ({ id: b.id, name: b.name, icon: b.icon, description: b.description, note: b.note, size: b.items.filter((m) => !m.insteadOf).length });

function createBundles({ modrinth, content }) {
  const find = (id) => {
    const bundle = BUNDLES.find((b) => b.id === id);
    if (!bundle) throw new Error('Nie ma takiego zestawu.');
    return bundle;
  };

  /** The sets, without asking Modrinth: [{ id, name, icon, description, note, size }]. */
  const list = () => BUNDLES.map(meta);

  /**
   * A set for one instance: { ...meta, supported, mods: [{ slug, name, why, type, available, installed, version }] }.
   * Mods need a mod loader – for a vanilla instance nothing is looked up (supported: false).
   */
  async function plan(instance, id) {
    const bundle = find(id);
    if (instance.loader === 'vanilla') return { ...meta(bundle), supported: false, mods: [] };
    const mods = visibleMods(await resolveMods({ modrinth, content, instance, items: bundle.items.map((m) => ({ type: 'mod', ...m })) }));
    return { ...meta(bundle), supported: true, mods };
  }

  /** Installs what exists of a set; returns { installed, skipped, warnings, missing }. */
  async function install(instance, id, { onProgress } = {}) {
    const planned = await plan(instance, id);
    if (!planned.supported) throw new Error('Mody wymagają loadera (Fabric, Quilt, NeoForge albo Forge) – zmień go w ustawieniach instancji.');
    return installPlanned({ content, instance, mods: planned.mods, onProgress });
  }

  return { list, plan, install };
}

module.exports = { createBundles, BUNDLES };
