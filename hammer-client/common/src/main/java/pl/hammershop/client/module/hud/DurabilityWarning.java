package pl.hammershop.client.module.hud;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Theme;

/** A warning banner when armour or the held tool is about to break. */
public final class DurabilityWarning extends HudModule {
    private final Setting.Slider threshold = slider("threshold", 0.1f, 0.03f, 0.3f, 0.01f, "%");

    public DurabilityWarning() {
        super("durability", "warning", Category.GAMEPLAY, true, Anchor.BOTTOM_CENTER);
    }

    @Override
    protected void draw(HudCanvas c) {
        Game.Item worst = null;
        float worstShare = 1f;
        for (Game.Item it : c.game.equipment()) {
            if (it.empty() || !it.damageable()) continue;
            float share = (float) it.left() / it.maxDamage();
            if (share < worstShare) {
                worstShare = share;
                worst = it;
            }
        }
        String text;
        if (worst != null && worstShare <= threshold.value()) text = Lang.t("hud.durability", worst.name(), worst.left());
        else if (c.editor) text = Lang.t("hud.durability", Lang.t("hud.sample_item"), 12);
        else return;
        float pulse = 0.75f + 0.25f * (float) Math.sin(System.currentTimeMillis() / 180.0);
        float w = c.textWidth(text) + 22;
        c.d.rrect(0, 0, w, 14, 3, 0x90300A0A);
        c.d.icon("warning", 4, 2.5f, 9, Draw.alpha(Theme.WARN, pulse));
        c.text(text, 17, 3, Draw.alpha(0xFFFFE0E0, pulse), true);
        c.size(w, 14);
    }
}
