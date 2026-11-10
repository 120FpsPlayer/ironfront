package pl.hammershop.client.module.hud;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Platform.Move;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;

/** W A S D, mouse buttons (with CPS) and the space bar – lit while pressed, with a short fade. */
public final class Keystrokes extends HudModule {
    private static final float K = 20;
    private static final float GAP = 2;

    private final Setting.Bool mouse = bool("mouse_buttons", true);
    private final Setting.Bool cps = bool("show_cps", true);
    private final Setting.Bool space = bool("space_bar", true);
    private final Setting.Color pressed = color("pressed_color", 0xE0FF9F43, true);
    private final Setting.Color text = color("text_color", 0xFFFFFFFF, true);
    private final Setting.Color backgroundColor = color("background_color", 0x70000000, false);
    private final float[] glow = new float[7];
    private long last = System.nanoTime();

    public Keystrokes() {
        super("keystrokes", "keystrokes", true, Anchor.TOP_LEFT);
            order = 20;
    }

    @Override
    protected void draw(HudCanvas c) {
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        float w = K * 3 + GAP * 2;
        key(c, 0, Move.FORWARD, null, K + GAP, 0, K, K, dt);
        key(c, 1, Move.LEFT, null, 0, K + GAP, K, K, dt);
        key(c, 2, Move.BACK, null, K + GAP, K + GAP, K, K, dt);
        key(c, 3, Move.RIGHT, null, (K + GAP) * 2, K + GAP, K, K, dt);
        float y = (K + GAP) * 2;
        if (mouse.on()) {
            float half = (w - GAP) / 2f;
            String l = Lang.t("hud.lmb");
            String r = Lang.t("hud.rmb");
            if (cps.on()) {
                l += " " + Hammer.stats().cpsLeft();
                r += " " + Hammer.stats().cpsRight();
            }
            key(c, 4, Move.ATTACK, l, 0, y, half, K, dt);
            key(c, 5, Move.USE, r, half + GAP, y, w - half - GAP, K, dt);
            y += K + GAP;
        }
        if (space.on()) {
            float a = fade(6, c.platform.moveKey(Move.JUMP), dt);
            c.d.rrect(0, y, w, 10, 2.5f, Draw.mix(backgroundColor.get(), pressed.argb(), a));
            c.d.rrect(w / 2f - 12, y + 4, 24, 2, 1, Draw.mix(text.argb(), 0xFF2A1405, a));
            y += 10 + GAP;
        }
        c.size(w, y - GAP);
    }

    private float fade(int i, boolean down, float dt) {
        glow[i] = down ? 1f : Math.max(0f, glow[i] - dt * 6f);
        return glow[i];
    }

    private void key(HudCanvas c, int i, Move key, String label, float x, float y, float w, float h, float dt) {
        float a = fade(i, c.platform.moveKey(key), dt);
        c.d.rrect(x, y, w, h, 2.5f, Draw.mix(backgroundColor.get(), pressed.argb(), a));
        String t = label != null ? label : c.platform.moveKeyName(key);
        if (t.length() > 6) t = t.substring(0, 6);
        float tw = c.textWidth(t);
        c.text(t, x + (w - tw) / 2f, y + (h - 8) / 2f, Draw.mix(text.argb(), 0xFF2A1405, a), a < 0.5f);
    }
}
