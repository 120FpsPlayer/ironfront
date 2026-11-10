package pl.hammershop.client.module.hud;

import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;

/** The Hammer logo in a corner of the screen (off by default). */
public final class Watermark extends HudModule {
    private final Setting.Bool name = bool("show_name", true);
    private final Setting.Color text = color("text_color", 0xFFFFFFFF, true);

    public Watermark() {
        super("watermark", "hammer", false, Anchor.BOTTOM_LEFT);
    }

    @Override
    protected void draw(HudCanvas c) {
        c.d.image("logo", 256, 256, 1, 1, 14, 14, 0xFFFFFFFF);
        float w = 16;
        if (name.on()) w = c.text("Hammer Client", 18, 4, text.argb(), true) + 3;
        c.size(w, 16);
    }
}
