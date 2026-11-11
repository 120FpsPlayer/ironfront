package pl.hammershop.client.module.feature;

import pl.hammershop.client.api.Gfx;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;

/** The player list (Tab) shows everyone's ping as a number instead of the signal bars. */
public final class TabPing extends Module {
    private final Setting.Bool colored = bool("ping_colors", true);

    public TabPing() {
        super("tabping", "tab", Category.VISUAL, true);
    }

    /** Green → red like the vanilla bars. */
    public static int color(int ms) {
        if (ms < 0) return 0xFFAAAAAA;
        if (ms < 80) return 0xFF5EE08D;
        if (ms < 150) return 0xFFB6E35E;
        if (ms < 300) return 0xFFFFC857;
        if (ms < 600) return 0xFFFF9F43;
        return 0xFFFF7A7A;
    }

    /** Draws into the place of the vanilla icon: the last 10 × 8 pixels of a row that starts at x and is `width` wide. */
    public void render(Gfx g, int x, int y, int width, int latency) {
        String text = latency < 0 ? "?" : latency > 9999 ? "9999" : String.valueOf(latency);
        int tw = Math.max(1, g.mcTextWidth(text));
        float scale = Math.min(0.75f, 11f / tw);
        g.push();
        g.translate(x + width - 0.5f - tw * scale, y + (8f - 8f * scale) / 2f + 0.5f);
        g.scale(scale, scale);
        g.mcText(text, 0, 0, colored.on() ? color(latency) : 0xFFFFFFFF, true);
        g.pop();
    }
}
