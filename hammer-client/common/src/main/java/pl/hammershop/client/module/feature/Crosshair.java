package pl.hammershop.client.module.feature;

import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;

/** Your own crosshair instead of the vanilla one: shape, size, gap, thickness, colour, outline. */
public final class Crosshair extends Module {
    private final Setting.Choice style = choice("crosshair_style", 0, "cross", "plus", "dot", "circle", "square");
    private final Setting.Slider size = slider("size", 5, 2, 14, 1, "");
    private final Setting.Slider gap = slider("gap", 2, 0, 8, 1, "");
    private final Setting.Slider thickness = slider("thickness", 1, 1, 4, 1, "");
    private final Setting.Color color = color("color", 0xFFFFFFFF, true);
    private final Setting.Bool outline = bool("outline", true);
    private final Setting.Bool centerDot = bool("center_dot", false);
    private final Setting.Bool hideInThirdPerson = bool("hide_third_person", true);

    public Crosshair() {
        super("crosshair", "crosshair", Category.VISUAL, false);
    }

    public boolean hiddenInThirdPerson() {
        return hideInThirdPerson.on();
    }

    /** Draws the crosshair centred on (cx, cy), in GUI pixels. */
    public void render(Draw d, float cx, float cy) {
        int c = color.argb();
        int o = outline.on() ? Draw.alpha(0xFF000000, ((c >>> 24) & 0xFF) / 255f * 0.85f) : 0;
        float s = size.value();
        float g = gap.value();
        float t = thickness.value();
        float half = t / 2f;
        String st = style.option();
        switch (st) {
            case "dot" -> {
                if (o != 0) d.circle(cx, cy, t + 1.6f, o);
                d.circle(cx, cy, t + 0.8f, c);
            }
            case "circle" -> {
                if (o != 0) d.ring(cx, cy, s + 0.8f, o);
                d.ring(cx, cy, s, c);
                if (centerDot.on()) d.circle(cx, cy, 1f, c);
            }
            case "square" -> {
                bar(d, cx - s, cy - s, s * 2, t, c, o);
                bar(d, cx - s, cy + s - t, s * 2, t, c, o);
                bar(d, cx - s, cy - s + t, t, s * 2 - t * 2, c, o);
                bar(d, cx + s - t, cy - s + t, t, s * 2 - t * 2, c, o);
                if (centerDot.on()) bar(d, cx - half, cy - half, t, t, c, 0);
            }
            default -> {
                float gg = st.equals("plus") ? 0 : g;
                // outlines first, so they never cover a neighbouring arm
                if (o != 0) {
                    d.fill(cx - half - 1, cy - gg - s - 1, t + 2, s + 2, o);
                    d.fill(cx - half - 1, cy + gg - 1, t + 2, s + 2, o);
                    d.fill(cx - gg - s - 1, cy - half - 1, s + 2, t + 2, o);
                    d.fill(cx + gg - 1, cy - half - 1, s + 2, t + 2, o);
                    if (centerDot.on() || st.equals("plus")) d.fill(cx - half - 1, cy - half - 1, t + 2, t + 2, o);
                }
                d.fill(cx - half, cy - gg - s, t, s, c);
                d.fill(cx - half, cy + gg, t, s, c);
                d.fill(cx - gg - s, cy - half, s, t, c);
                d.fill(cx + gg, cy - half, s, t, c);
                if (centerDot.on() || st.equals("plus")) d.fill(cx - half, cy - half, t, t, c);
            }
        }
    }

    private static void bar(Draw d, float x, float y, float w, float h, int c, int o) {
        if (o != 0) d.fill(x - 1, y - 1, w + 2, h + 2, o);
        d.fill(x, y, w, h, c);
    }
}
