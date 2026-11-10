package pl.hammershop.client.module;

import pl.hammershop.client.api.Game;

import java.util.ArrayList;
import java.util.List;

/** A HUD module made of "label + value" lines, with the shared look options (format, colours, background). */
public abstract class TextHud extends HudModule {
    public final Setting.Choice format = choice("format", 0, "label_value", "value_label", "brackets");
    public final Setting.Color valueColor = color("text_color", 0xFFFFFFFF, true);
    public final Setting.Color labelColor = color("label_color", 0xFFFF9F43, true);
    public final Setting.Bool background = bool("background", true);
    public final Setting.Color backgroundColor = color("background_color", 0x70000000, false);
    public final Setting.Bool shadow = bool("shadow", true);

    private final List<String[]> lines = new ArrayList<>();

    protected TextHud(String id, String icon, boolean defaultOn, Anchor anchor) {
        super(id, icon, defaultOn, anchor);
    }

    protected TextHud(String id, String icon, Category category, boolean defaultOn, Anchor anchor) {
        super(id, icon, category, defaultOn, anchor);
    }

    /** Adds {label, value} lines (label may be ""). Add nothing to hide the module. */
    protected abstract void lines(Game game, boolean editor, List<String[]> out);

    protected static String[] line(String label, String value) {
        return new String[] {label, value};
    }

    @Override
    protected void draw(HudCanvas c) {
        lines.clear();
        lines(c.game, c.editor, lines);
        if (lines.isEmpty()) return;
        int fmt = format.get();
        float width = 0;
        for (String[] l : lines) width = Math.max(width, c.textWidth(compose(l, fmt)));
        float w = width + 8;
        float h = lines.size() * HudCanvas.LINE + 4;
        if (background.on()) c.plate(w, h, backgroundColor.get());
        int label = labelColor.argb();
        int value = valueColor.argb(0.15f);
        boolean sh = shadow.on();
        float y = 3;
        for (String[] l : lines) {
            float x = 4;
            if (l[0].isEmpty()) c.text(l[1], x, y, value, sh);
            else if (fmt == 0) {
                x = c.text(l[0] + ": ", x, y, label, sh);
                c.text(l[1], x, y, value, sh);
            } else if (fmt == 1) {
                x = c.text(l[1] + " ", x, y, value, sh);
                c.text(l[0], x, y, label, sh);
            } else {
                x = c.text("[", x, y, label, sh);
                x = c.text(l[1] + " " + l[0], x, y, value, sh);
                c.text("]", x, y, label, sh);
            }
            y += HudCanvas.LINE;
        }
        c.size(w, h);
    }

    private static String compose(String[] l, int fmt) {
        if (l[0].isEmpty()) return l[1];
        return fmt == 0 ? l[0] + ": " + l[1] : fmt == 1 ? l[1] + " " + l[0] : "[" + l[1] + " " + l[0] + "]";
    }
}
