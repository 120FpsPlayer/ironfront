package pl.hammershop.client.screens;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;

/** The picture behind our menus: the Hammer dusk scene with a slow drift, a warm shade and rising sparks. */
public final class Backdrop {
    private Backdrop() {
    }

    /** Hammer+ backgrounds: the same scene in another light – {id, tint of the picture, colour of the sun's glow}. */
    private static final Object[][] THEMES = {
            {"night", 0xFF7FA4FF, 0xFF9CC2FF},
            {"aurora", 0xFF63F2C4, 0xFF9CFFE0},
            {"lava", 0xFFFF6A45, 0xFFFFB06A},
            {"gold", 0xFFFFD45E, 0xFFFFF0B0},
    };

    /** Full menu background. `shade` darkens the left side (for the main menu's buttons). */
    public static void menu(Ui ui, boolean shade) {
        Draw d = ui.d;
        float t = Hammer.animations() ? ui.time : 0f;
        float pan = (float) Math.sin(t * 0.05f) * 0.6f;
        d.fill(0, 0, ui.w, ui.h, Theme.BG);
        String id = Hammer.config().menuBackgroundInUse();
        Object[] theme = null;
        for (Object[] th : THEMES) if (th[0].equals(id)) theme = th;
        int[] own = "custom".equals(id) ? custom() : null;
        if (own != null) {
            d.cover("custom_menu", own[0], own[1], 0, 0, ui.w, ui.h, 1.04f, pan, 0f, 0xFFFFFFFF);
            d.fill(0, 0, ui.w, ui.h, 0x33080503); // a light shade so the buttons stay readable on any picture
        } else if (theme == null) d.cover("background", 1280, 720, 0, 0, ui.w, ui.h, 1.08f, pan, 0.2f, 0xFFFFFFFF);
        else {
            d.cover("background_mono", 1280, 720, 0, 0, ui.w, ui.h, 1.08f, pan, 0.2f, (Integer) theme[1]);
            // the sun of the scene sits to the right of the middle, a little below it
            float pulse = Hammer.animations() ? 0.85f + 0.15f * (float) Math.sin(t * 0.8f) : 1f;
            d.glow(ui.w * 0.735f, ui.h * 0.585f, ui.h * 0.5f, Draw.alpha((Integer) theme[2], 0.20f * pulse));
            d.glow(ui.w * 0.735f, ui.h * 0.585f, ui.h * 0.16f, Draw.alpha((Integer) theme[2], 0.38f * pulse));
        }
        d.gradient(0, 0, ui.w, ui.h * 0.4f, 0x99080503, 0x00080503);
        d.gradient(0, ui.h * 0.55f, ui.w, ui.h * 0.45f, 0x00080503, 0xD9080503);
        if (shade) d.fade(0, 0, ui.w * 0.62f, ui.h, 0xE6080503, false);
        embers(ui);
    }

    private static int[] customSize;
    private static boolean customTried;

    /** The player's own picture as a texture (loaded once): {width, height}, or null when there is none. */
    public static int[] custom() {
        if (!customTried) {
            customTried = true;
            try {
                java.nio.file.Path file = Hammer.config().customMenuImage();
                if (file != null && java.nio.file.Files.isRegularFile(file)) customSize = Hammer.platform().loadImage("custom_menu", file);
            } catch (RuntimeException e) {
                pl.hammershop.client.core.Log.warn("Nie udało się wczytać własnego tła menu", e);
            }
        }
        return customSize;
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
