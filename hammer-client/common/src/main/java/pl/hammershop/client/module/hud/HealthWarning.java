package pl.hammershop.client.module.hud;

import pl.hammershop.client.core.Fmt;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;

/** A pulsing warning when your health drops below the limit you set. */
public final class HealthWarning extends HudModule {
    private final Setting.Slider hearts = slider("hearts", 3f, 1f, 8f, 0.5f, "");

    public HealthWarning() {
        super("lowhealth", "heart", Category.GAMEPLAY, false, Anchor.BOTTOM_CENTER);
        order = 1;
    }

    @Override
    protected void draw(HudCanvas c) {
        float hp = c.game.health();
        boolean low = c.game.inWorld() && hp > 0 && hp <= hearts.value() * 2f;
        if (!low && !c.editor) return;
        String text = Lang.t("hud.low_health", Fmt.num((low ? hp : 5f) / 2f, 1));
        float pulse = 0.7f + 0.3f * (float) Math.sin(System.currentTimeMillis() / 140.0);
        float w = c.textWidth(text) + 22;
        c.d.rrect(0, 0, w, 14, 3, 0xA0400808);
        c.d.icon("heart", 4, 2.5f, 9, Draw.alpha(0xFFFF6B6B, pulse));
        c.text(text, 17, 3, Draw.alpha(0xFFFFE0E0, pulse), true);
        c.size(w, 14);
    }
}
