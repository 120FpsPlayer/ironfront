package pl.hammershop.client.module.feature;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;

/**
 * Your own crosshair instead of the vanilla one: shape, size, gap, thickness, colour, outline. With Hammer+: three
 * more shapes and animation (pulse, breathing gap, a gap that opens when you move or hit).
 */
public final class Crosshair extends Module {
    private final Setting.Choice style = choice("crosshair_style", 0, "cross", "plus", "dot", "circle", "square", "chevron", "tee", "diamond");
    private final Setting.Choice animation = choice("crosshair_anim", 0, "anim_none", "anim_pulse", "anim_breathe", "anim_dynamic");
    private final Setting.Slider size = slider("size", 5, 2, 14, 1, "");
    private final Setting.Slider gap = slider("gap", 2, 0, 8, 1, "");
    private final Setting.Slider thickness = slider("thickness", 1, 1, 4, 1, "");
    private final Setting.Color color = color("color", 0xFFFFFFFF, true);
    private final Setting.Bool outline = bool("outline", true);
    private final Setting.Bool centerDot = bool("center_dot", false);
    private final Setting.Bool hideInThirdPerson = bool("hide_third_person", true);

    public Crosshair() {
        super("crosshair", "crosshair", Category.VISUAL, false);
        style.premiumFrom = 5;
        animation.premiumFrom = 1;
    }

    public boolean hiddenInThirdPerson() {
        return hideInThirdPerson.on();
    }

    /** Draws the crosshair centred on (cx, cy), in GUI pixels. */
    public void render(Draw d, float cx, float cy) {
        // Drawn in real screen pixels, so an animated size moves smoothly and thin lines stay sharp at any GUI scale.
        float u = Math.max(1f, d.unit());
        d.push();
        d.translate(cx, cy);
        d.scale(1f / u);
        try {
            draw(d, u);
        } finally {
            d.pop();
        }
    }

    private void draw(Draw d, float u) {
        int c = color.argb();
        int o = outline.on() ? Draw.alpha(0xFF000000, ((c >>> 24) & 0xFF) / 255f * 0.85f) : 0;
        float s = size.value() * u;
        float g = gap.value() * u;
        float t = thickness.value() * u;
        double time = System.nanoTime() / 1e9;
        switch (animation.option()) {
            case "anim_pulse" -> s *= 1f + 0.2f * (float) Math.sin(time * 4.5);
            case "anim_breathe" -> g += (float) (Math.sin(time * 3.0) + 1.0) * 1.6f * u;
            case "anim_dynamic" -> {
                float kick = Math.max(0f, 1f - Hammer.stats().sinceHit() / 260f);
                g += (Math.min(6f, (float) Hammer.stats().speed() * 0.75f) + kick * 3.5f) * u;
            }
            default -> {
            }
        }
        s = Math.round(s);
        g = Math.round(g);
        float half = t / 2f;
        float edge = Math.max(1f, Math.round(u * 0.5f)); // outline width in real pixels
        String st = style.option();
        switch (st) {
            case "dot" -> {
                if (o != 0) d.circle(0, 0, t + 1.6f * u, o);
                d.circle(0, 0, t + 0.8f * u, c);
            }
            case "circle" -> {
                if (o != 0) d.ring(0, 0, s + 0.8f * u, o);
                d.ring(0, 0, s, c);
                if (centerDot.on()) d.circle(0, 0, u, c);
            }
            case "square" -> {
                bar(d, -s, -s, s * 2, t, c, o, edge);
                bar(d, -s, s - t, s * 2, t, c, o, edge);
                bar(d, -s, -s + t, t, s * 2 - t * 2, c, o, edge);
                bar(d, s - t, -s + t, t, s * 2 - t * 2, c, o, edge);
                if (centerDot.on()) bar(d, -half, -half, t, t, c, 0, edge);
            }
            case "chevron" -> {
                // two strokes that meet at the aim point and open downwards
                for (int pass = o != 0 ? 0 : 1; pass < 2; pass++) {
                    float grow = pass == 0 ? edge : 0;
                    int col = pass == 0 ? o : c;
                    for (float i = 0; i <= s; i += t) {
                        d.fill(-i - half - grow, g + i - grow, t + grow * 2, t + grow * 2, col);
                        d.fill(i - half - grow, g + i - grow, t + grow * 2, t + grow * 2, col);
                    }
                }
                if (centerDot.on()) bar(d, -half, -half, t, t, c, o, edge);
            }
            case "diamond" -> {
                for (int pass = o != 0 ? 0 : 1; pass < 2; pass++) {
                    float grow = pass == 0 ? edge : 0;
                    int col = pass == 0 ? o : c;
                    float r = s + g;
                    for (float i = 0; i <= r; i += t) {
                        d.fill(-r + i - half - grow, -i - half - grow, t + grow * 2, t + grow * 2, col);
                        d.fill(r - i - half - grow, -i - half - grow, t + grow * 2, t + grow * 2, col);
                        d.fill(-r + i - half - grow, i - half - grow, t + grow * 2, t + grow * 2, col);
                        d.fill(r - i - half - grow, i - half - grow, t + grow * 2, t + grow * 2, col);
                    }
                }
                if (centerDot.on()) bar(d, -half, -half, t, t, c, o, edge);
            }
            default -> {
                boolean top = !st.equals("tee");
                float gg = st.equals("plus") ? 0 : g;
                boolean dot = centerDot.on() || st.equals("plus");
                // outlines first, so they never cover a neighbouring arm
                if (o != 0) {
                    if (top) d.fill(-half - edge, -gg - s - edge, t + edge * 2, s + edge * 2, o);
                    d.fill(-half - edge, gg - edge, t + edge * 2, s + edge * 2, o);
                    d.fill(-gg - s - edge, -half - edge, s + edge * 2, t + edge * 2, o);
                    d.fill(gg - edge, -half - edge, s + edge * 2, t + edge * 2, o);
                    if (dot) d.fill(-half - edge, -half - edge, t + edge * 2, t + edge * 2, o);
                }
                if (top) d.fill(-half, -gg - s, t, s, c);
                d.fill(-half, gg, t, s, c);
                d.fill(-gg - s, -half, s, t, c);
                d.fill(gg, -half, s, t, c);
                if (dot) d.fill(-half, -half, t, t, c);
            }
        }
    }

    private static void bar(Draw d, float x, float y, float w, float h, int c, int o, float edge) {
        if (o != 0) d.fill(x - edge, y - edge, w + edge * 2, h + edge * 2, o);
        d.fill(x, y, w, h, c);
    }
}
