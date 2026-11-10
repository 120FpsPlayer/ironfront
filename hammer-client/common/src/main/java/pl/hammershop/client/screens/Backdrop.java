package pl.hammershop.client.screens;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;

/** The picture behind our menus: the Hammer dusk scene with a slow drift, a warm shade and rising sparks. */
public final class Backdrop {
    private Backdrop() {
    }

    /** Full menu background. `shade` darkens the left side (for the main menu's buttons). */
    public static void menu(Ui ui, boolean shade) {
        Draw d = ui.d;
        float t = Hammer.animations() ? ui.time : 0f;
        float pan = (float) Math.sin(t * 0.05f) * 0.6f;
        d.fill(0, 0, ui.w, ui.h, Theme.BG);
        d.cover("background", 1280, 720, 0, 0, ui.w, ui.h, 1.08f, pan, 0.2f, 0xFFFFFFFF);
        d.gradient(0, 0, ui.w, ui.h * 0.4f, 0x99080503, 0x00080503);
        d.gradient(0, ui.h * 0.55f, ui.w, ui.h * 0.45f, 0x00080503, 0xD9080503);
        if (shade) d.fade(0, 0, ui.w * 0.62f, ui.h, 0xE6080503, false);
        embers(ui);
    }

    /** Dim layer over the running game (module panel, HUD editor). */
    public static void dim(Ui ui, float strength) {
        ui.d.fill(0, 0, ui.w, ui.h, Draw.alpha(0xFF080503, strength));
    }

    public static void embers(Ui ui) {
        if (!Hammer.animations()) return;
        Draw d = ui.d;
        float t = ui.time;
        for (int i = 0; i < 38; i++) {
            long seed = (i * 2654435761L) & 0xFFFFFFL;
            float speed = 9f + seed % 17;
            float travel = ui.h + 60;
            float y = ui.h + 20 - ((t * speed + (seed % 997) * 3f) % travel);
            float x = (seed * 31 % 1000) / 1000f * ui.w + (float) Math.sin(t * 0.7f + i) * 10f;
            float life = Math.max(0f, 1f - (ui.h + 20 - y) / travel);
            float r = 2.5f + seed % 3;
            int c = i % 3 == 0 ? Theme.accentLight() : Theme.accent();
            d.glow(x, y, r * 3.2f, Draw.alpha(c, 0.22f * life));
            d.circle(x, y, r * 0.42f, Draw.alpha(0xFFFFE9CF, 0.75f * life));
        }
    }
}
