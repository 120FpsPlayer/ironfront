package pl.hammershop.client.screens;

import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;

/** The gold Hammer+ marks: the badge of a member and the little lock on options that need Hammer+. */
public final class PlusBadge {
    public static final int GOLD = 0xFFFFC83D;
    public static final int GOLD_LIGHT = 0xFFFFE9A6;
    public static final int GOLD_DARK = 0xFFE0A106;
    private static final int INK = 0xFF3A2400;

    private PlusBadge() {
    }

    public static float width(Draw d, float h) {
        return d.textWidth("HAMMER+", h * 0.6f, Font.BOLD) + h * 1.75f;
    }

    /** The "HAMMER+" pill with its left edge at x; returns its width. */
    public static float draw(Draw d, float x, float y, float h, float alpha) {
        float w = width(d, h);
        d.shadow(x, y + 1, w, h, h * 0.45f, Draw.alpha(GOLD, 0.28f * alpha));
        d.rgradient(x, y, w, h, h / 2f, Draw.alpha(GOLD_LIGHT, alpha), Draw.alpha(GOLD_DARK, alpha));
        d.icon("crown", x + h * 0.42f, y + h * 0.22f, h * 0.56f, Draw.alpha(INK, alpha));
        d.textIn("HAMMER+", x + h * 1.2f, y, h, h * 0.6f, Draw.alpha(INK, alpha), Font.BOLD);
        return w;
    }

    /** "🔒 Hammer+" chip ending at `right` (for an option the player cannot use yet); returns its left edge. */
    public static float lock(Draw d, float right, float y, float h) {
        float w = d.textWidth("Hammer+", 7.5f, Font.BOLD) + 26;
        float x = right - w;
        d.panel(x, y, w, h, h / 2f, Draw.alpha(GOLD, 0.10f), Draw.alpha(GOLD, 0.45f));
        d.icon("lock", x + 8, y + (h - 8) / 2f, 8, GOLD);
        d.textIn("Hammer+", x + 20, y, h, 7.5f, GOLD_LIGHT, Font.BOLD);
        return x;
    }
}
