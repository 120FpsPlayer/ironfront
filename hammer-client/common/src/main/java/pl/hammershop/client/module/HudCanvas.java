package pl.hammershop.client.module;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;

/** What a HUD module draws on: its own little coordinate space starting at (0, 0), in GUI pixels × the module's scale. */
public final class HudCanvas {
    public static final int LINE = 10;

    public final Draw d;
    public final Game game;
    public final Platform platform;
    /** In the HUD editor: show sample content even when there is nothing to show. */
    public final boolean editor;
    /** Smooth Hammer font instead of Minecraft's pixel font. */
    public final boolean smooth;
    float w;
    float h;

    public HudCanvas(Draw d, Game game, Platform platform, boolean editor, boolean smooth) {
        this.d = d;
        this.game = game;
        this.platform = platform;
        this.editor = editor;
        this.smooth = smooth;
    }

    /** The module reports how big it drew itself (0 × 0 = nothing to show). */
    public void size(float w, float h) {
        this.w = w;
        this.h = h;
    }

    public float textWidth(String text) {
        return smooth ? d.textWidth(text, 8f, Font.MEDIUM) : d.g.mcTextWidth(text);
    }

    /** Text with its 8-pixel-tall glyph box starting at (x, y); returns the x after it. */
    public float text(String text, float x, float y, int argb, boolean shadow) {
        if (smooth) {
            if (shadow) d.text(text, x + 0.6f, y - 0.4f, 8f, Draw.alpha(0xFF000000, ((argb >>> 24) & 0xFF) / 255f * 0.7f), Font.MEDIUM);
            return d.text(text, x, y - 1f, 8f, argb, Font.MEDIUM);
        }
        d.g.mcText(text, Math.round(x), Math.round(y), argb, shadow);
        return x + d.g.mcTextWidth(text);
    }

    /** The module's background plate. */
    public void plate(float w, float h, int argb) {
        d.rrect(0, 0, w, h, 2.5f, argb);
    }
}
