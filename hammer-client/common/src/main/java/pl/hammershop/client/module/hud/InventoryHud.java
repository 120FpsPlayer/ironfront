package pl.hammershop.client.module.hud;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;

import java.util.List;

/** The three inventory rows, always visible – handy when mining or sorting loot. */
public final class InventoryHud extends HudModule {
    private final Setting.Color backgroundColor = color("background_color", 0x80000000, false);
    private final Setting.Color slotColor = color("slot_color", 0x30FFFFFF, false);
    private final Setting.Bool hideEmpty = bool("hide_when_empty", false);

    public InventoryHud() {
        super("inventory", "inventory", false, Anchor.BOTTOM_RIGHT);
            order = 1;
    }

    @Override
    protected void draw(HudCanvas c) {
        List<Game.Item> inv = c.game.inventory();
        boolean any = false;
        for (int i = 9; i < Math.min(36, inv.size()); i++) any |= !inv.get(i).empty();
        if (!any && hideEmpty.on() && !c.editor) return;
        float w = 9 * 18 + 4;
        float h = 3 * 18 + 4;
        c.plate(w, h, backgroundColor.get());
        for (int row = 0; row < 3; row++) {
            for (int col = 0; col < 9; col++) {
                float x = 3 + col * 18;
                float y = 3 + row * 18;
                c.d.rrect(x, y, 16, 16, 2, slotColor.get());
                int slot = 9 + row * 9 + col;
                if (slot >= inv.size()) continue;
                Game.Item it = inv.get(slot);
                if (it.empty()) continue;
                c.d.g.item(it.handle(), Math.round(x), Math.round(y));
                if (it.count() > 1) {
                    String n = String.valueOf(it.count());
                    c.d.push();
                    c.d.translate(x + 17 - c.textWidth(n) * 0.75f, y + 10);
                    c.d.scale(0.75f);
                    c.text(n, 0, 0, 0xFFFFFFFF, true);
                    c.d.pop();
                }
            }
        }
        c.size(w, h);
    }
}
