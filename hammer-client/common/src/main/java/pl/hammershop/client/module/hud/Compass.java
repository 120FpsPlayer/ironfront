package pl.hammershop.client.module.hud;

import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;

/** Direction HUD: a strip that slides as you turn, with N / E / S / W and degree ticks. */
public final class Compass extends HudModule {
    private final Setting.Slider width = slider("width", 140, 80, 260, 10, "");
    private final Setting.Bool degrees = bool("degrees", true);
    private final Setting.Color marks = color("text_color", 0xFFFFFFFF, true);
    private final Setting.Color accent = color("label_color", 0xFFFF9F43, true);
    private final Setting.Bool background = bool("background", true);
    private final Setting.Color backgroundColor = color("background_color", 0x70000000, false);

    public Compass() {
        super("compass", "compass", false, Anchor.TOP_CENTER);
    }

    @Override
    protected void draw(HudCanvas c) {
        float w = width.value();
        float h = degrees.on() ? 26 : 18;
        // Bearing: 0 = north, 90 = east (Minecraft yaw 0 = south).
        float bearing = ((c.game.yaw() + 180f) % 360f + 360f) % 360f;
        if (background.on()) c.plate(w, h, backgroundColor.get());
        float pxPerDeg = w / 120f; // 120° visible
        String[] names = {Lang.t("compass.n"), "NE", Lang.t("compass.e"), "SE", Lang.t("compass.s"), "SW", Lang.t("compass.w"), "NW"};
        int tick = marks.argb();
        int main = accent.argb();
        for (int deg = 0; deg < 360; deg += 15) {
            float diff = ((deg - bearing + 540f) % 360f) - 180f;
            float x = w / 2f + diff * pxPerDeg;
            if (x < 4 || x > w - 4) continue;
            float edge = Math.min(1f, Math.min(x - 4, w - 4 - x) / 14f);
            if (deg % 45 == 0) {
                String n = names[deg / 45];
                boolean cardinal = deg % 90 == 0;
                c.text(n, x - c.textWidth(n) / 2f, 4, Draw.alpha(cardinal ? main : tick, edge), true);
            } else c.d.fill(x - 0.5f, 6, 1, 5, Draw.alpha(tick, edge * 0.6f));
        }
        c.d.fill(w / 2f - 0.5f, h - 3, 1, 3, main);
        if (degrees.on()) {
            String d = Math.round(bearing) % 360 + "°";
            c.text(d, w / 2f - c.textWidth(d) / 2f, 15, tick, true);
        }
        c.size(w, h);
    }
}
