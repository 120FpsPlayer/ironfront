package pl.hammershop.client.module;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import pl.hammershop.client.config.HammerConfig;

/** A module drawn on the HUD. render() draws at (0, 0) and returns its size, which the layout and editor use. */
public abstract class HudModule extends Module {
    private final float defaultX;
    private final float defaultY;
    public int width = 40;
    public int height = 12;

    protected HudModule(String id, boolean defaultOn, float defaultX, float defaultY) {
        this(id, Category.HUD, defaultOn, defaultX, defaultY);
    }

    protected HudModule(String id, Category category, boolean defaultOn, float defaultX, float defaultY) {
        super(id, category, defaultOn);
        this.defaultX = defaultX;
        this.defaultY = defaultY;
    }

    /** Draws the module; `editor` = show sample content even when there is nothing to show (e.g. no effects). */
    protected abstract int[] draw(GuiGraphics g, Minecraft mc, boolean editor);

    public final void render(GuiGraphics g, Minecraft mc, boolean editor) {
        int[] size = draw(g, mc, editor);
        width = size[0];
        height = size[1];
    }

    public float x() {
        float x = state().x;
        return x < 0 ? defaultX : x;
    }

    public float y() {
        float y = state().y;
        return y < 0 ? defaultY : y;
    }

    /** Top-left corner on a screen of sw × sh (HUD-scaled) pixels. */
    public int left(int sw) {
        return Math.round(HammerConfig.clamp(x(), 0f, 1f) * Math.max(0, sw - width));
    }

    public int top(int sh) {
        return Math.round(HammerConfig.clamp(y(), 0f, 1f) * Math.max(0, sh - height));
    }

    /** Stores a dragged position (pixels) as shares of the free space. */
    public void moveTo(int px, int py, int sw, int sh) {
        HammerConfig.ModuleState s = state();
        s.x = sw > width ? HammerConfig.clamp((float) px / (sw - width), 0f, 1f) : 0f;
        s.y = sh > height ? HammerConfig.clamp((float) py / (sh - height), 0f, 1f) : 0f;
    }

    public void resetPosition() {
        HammerConfig.ModuleState s = state();
        s.x = -1f;
        s.y = -1f;
    }
}
