package pl.hammershop.client.module.hud;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;

import java.util.ArrayList;
import java.util.List;

/** How many totems, golden apples, pearls, arrows… you carry (inventory + hands), each with its icon. */
public final class ItemCounter extends HudModule {
    private final Setting.Bool totems = bool("totems", true);
    private final Setting.Bool apples = bool("golden_apples", true);
    private final Setting.Bool pearls = bool("ender_pearls", true);
    private final Setting.Bool arrows = bool("arrows", true);
    private final Setting.Bool crystals = bool("crystals", false);
    private final Setting.Bool bottles = bool("xp_bottles", false);
    private final Setting.Bool background = bool("background", true);
    private final Setting.Color backgroundColor = color("background_color", 0x70000000, false);

    public ItemCounter() {
        super("items", "items", false, Anchor.BOTTOM_RIGHT);
            order = 2;
    }

    private record Entry(Object handle, int count) {
    }

    @Override
    protected void draw(HudCanvas c) {
        List<Game.Item> all = new ArrayList<>(c.game.inventory());
        List<Game.Item> eq = c.game.equipment();
        if (eq.size() > 5) all.add(eq.get(5)); // off hand
        List<Entry> entries = new ArrayList<>();
        if (totems.on()) add(entries, all, "minecraft:totem_of_undying");
        if (apples.on()) add(entries, all, "minecraft:golden_apple", "minecraft:enchanted_golden_apple");
        if (pearls.on()) add(entries, all, "minecraft:ender_pearl");
        if (arrows.on()) add(entries, all, "minecraft:arrow", "minecraft:spectral_arrow", "minecraft:tipped_arrow");
        if (crystals.on()) add(entries, all, "minecraft:end_crystal");
        if (bottles.on()) add(entries, all, "minecraft:experience_bottle");
        if (entries.isEmpty()) {
            if (!c.editor) return;
            entries.add(new Entry("sample:totem", 2));
            entries.add(new Entry("sample:arrow", 64));
        }
        float textW = 0;
        for (Entry e : entries) textW = Math.max(textW, c.textWidth("×" + e.count));
        float w = 20 + textW + 5;
        float h = entries.size() * 18 + 2;
        if (background.on()) c.plate(w, h, backgroundColor.get());
        for (int i = 0; i < entries.size(); i++) {
            Entry e = entries.get(i);
            c.d.g.item(e.handle, 2, 2 + i * 18);
            c.text("×" + e.count, 21, 6 + i * 18, 0xFFFFFFFF, true);
        }
        c.size(w, h);
    }

    private static void add(List<Entry> out, List<Game.Item> items, String... ids) {
        int count = 0;
        Object handle = null;
        for (Game.Item it : items) {
            if (it.empty()) continue;
            for (String id : ids) {
                if (id.equals(it.id())) {
                    count += it.count();
                    if (handle == null) handle = it.handle();
                }
            }
        }
        if (count > 0) out.add(new Entry(handle, count));
    }
}
