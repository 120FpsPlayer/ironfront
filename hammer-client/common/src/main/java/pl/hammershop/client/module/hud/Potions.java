package pl.hammershop.client.module.hud;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.core.Fmt;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;

import java.util.ArrayList;
import java.util.List;

/** Active effects with time left; the time blinks in the last 10 seconds. */
public final class Potions extends HudModule {
    private final Setting.Color text = color("text_color", 0xFFFFFFFF, true);
    private final Setting.Color time = color("label_color", 0xFFFFC27E, true);
    private final Setting.Bool background = bool("background", true);
    private final Setting.Color backgroundColor = color("background_color", 0x70000000, false);
    private final Setting.Bool blink = bool("blink", true);

    public Potions() {
        super("potions", "potions", true, Anchor.TOP_RIGHT);
            order = 20;
    }

    @Override
    protected void draw(HudCanvas c) {
        List<Game.Effect> effects = new ArrayList<>(c.game.effects());
        if (effects.isEmpty()) {
            if (!c.editor) return;
            effects.add(new Game.Effect(pl.hammershop.client.core.Lang.t("hud.sample_effect"), 1, 1800, false, 0x33EBFF, true));
            effects.add(new Game.Effect(pl.hammershop.client.core.Lang.t("hud.sample_effect2"), 0, 160, false, 0xFFC700, true));
        }
        String[] names = new String[effects.size()];
        String[] times = new String[effects.size()];
        float w = 0;
        for (int i = 0; i < effects.size(); i++) {
            Game.Effect e = effects.get(i);
            names[i] = e.name() + (e.amplifier() > 0 ? " " + Fmt.roman(e.amplifier() + 1) : "");
            times[i] = e.infinite() ? "∞" : Fmt.clock(e.ticks() / 20);
            w = Math.max(w, c.textWidth(names[i]) + c.textWidth(times[i]) + 10);
        }
        w += 18;
        float h = effects.size() * 11 + 4;
        if (background.on()) c.plate(w, h, backgroundColor.get());
        for (int i = 0; i < effects.size(); i++) {
            Game.Effect e = effects.get(i);
            float y = 3 + i * 11;
            c.d.rrect(4, y + 1, 6, 6, 2, 0xFF000000 | e.rgb());
            c.text(names[i], 14, y, text.argb(), true);
            boolean ending = blink.on() && !e.infinite() && e.ticks() < 200 && (System.currentTimeMillis() / 300) % 2 == 0;
            c.text(times[i], w - 4 - c.textWidth(times[i]), y, ending ? Draw.alpha(time.argb(), 0.35f) : time.argb(), true);
        }
        c.size(w, h);
    }
}
