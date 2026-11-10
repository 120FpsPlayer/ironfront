package pl.hammershop.client.module.hud;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Theme;

import java.util.ArrayList;
import java.util.List;

/** Armour and held items with the durability left (green → yellow → red). */
public final class Armor extends HudModule {
    private final Setting.Choice layout = choice("layout", 0, "vertical", "horizontal");
    private final Setting.Choice durability = choice("durability", 0, "number", "percent", "hidden");
    private final Setting.Bool hands = bool("hands", true);
    private final Setting.Bool background = bool("background", true);
    private final Setting.Color backgroundColor = color("background_color", 0x70000000, false);

    public Armor() {
        super("armor", "armor", true, Anchor.BOTTOM_RIGHT);
    }

    @Override
    protected void draw(HudCanvas c) {
        List<Game.Item> all = c.game.equipment();
        List<Game.Item> items = new ArrayList<>();
        for (int i = 0; i < all.size(); i++) {
            Game.Item it = all.get(i);
            if (it.empty()) continue;
            if (i >= 4 && (!hands.on() || !it.damageable())) continue;
            items.add(it);
        }
        if (items.isEmpty()) {
            if (!c.editor) return;
            items.add(new Game.Item("sample:helmet", "", "", 1, 40, 363));
            items.add(new Game.Item("sample:chestplate", "", "", 1, 300, 528));
        }
        boolean vertical = layout.get() == 0;
        int mode = durability.get();
        String[] texts = new String[items.size()];
        float maxText = 0;
        for (int i = 0; i < items.size(); i++) {
            Game.Item it = items.get(i);
            texts[i] = !it.damageable() || mode == 2 ? (it.count() > 1 ? "×" + it.count() : "") : mode == 0 ? String.valueOf(it.left()) : Math.round(it.left() * 100f / it.maxDamage()) + "%";
            maxText = Math.max(maxText, c.textWidth(texts[i]));
        }
        float cellW = 18 + (maxText > 0 ? maxText + 4 : 0);
        float w = vertical ? cellW + 2 : items.size() * cellW + 2;
        float h = vertical ? items.size() * 18 + 2 : 20;
        if (background.on()) c.plate(w, h, backgroundColor.get());
        for (int i = 0; i < items.size(); i++) {
            Game.Item it = items.get(i);
            float x = vertical ? 2 : 2 + i * cellW;
            float y = vertical ? 2 + i * 18 : 2;
            c.d.g.item(it.handle(), Math.round(x), Math.round(y));
            if (!texts[i].isEmpty()) {
                float share = it.damageable() ? (float) it.left() / it.maxDamage() : 1f;
                int col = !it.damageable() ? 0xFFFFFFFF : share > 0.5f ? Theme.OK : share > 0.2f ? Theme.WARN : Theme.ERR;
                c.text(texts[i], x + 18, y + 4, col, true);
            }
        }
        c.size(w, h);
    }
}
