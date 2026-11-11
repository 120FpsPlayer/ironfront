package pl.hammershop.client.module;

import pl.hammershop.client.Hammer;

/**
 * A module drawn on the in-game HUD. Until the player drags it somewhere, it sits in one of the corner / centre
 * stacks ({@link Anchor}) with the other modules of that stack, so nothing ever overlaps by default. Dragging it in
 * the HUD editor gives it its own place (kept as shares of the screen, so it fits any window size).
 */
public abstract class HudModule extends Module {
    public enum Anchor {
        TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT, TOP_CENTER, MIDDLE, BOTTOM_CENTER
    }

    public final Anchor anchor;
    /** Place inside the stack: lower numbers come first (nearest the corner). */
    public int order;
    public final Setting.Slider scale;
    /** Size of the last frame, before scaling (0 = drew nothing). */
    public float w = 40;
    public float h = 12;
    /** Where the automatic layout put it (GUI pixels). */
    float autoX;
    float autoY;

    protected HudModule(String id, String icon, boolean defaultOn, Anchor anchor) {
        this(id, icon, Category.HUD, defaultOn, anchor);
    }

    protected HudModule(String id, String icon, Category category, boolean defaultOn, Anchor anchor) {
        super(id, icon, category, defaultOn);
        this.anchor = anchor;
        this.scale = slider("scale", 1f, 0.5f, 2.5f, 0.05f, "x");
    }

    protected abstract void draw(HudCanvas c);

    public final void render(HudCanvas c) {
        c.w = 0;
        c.h = 0;
        draw(c);
        w = c.w;
        h = c.h;
    }

    private static float clamp01(float v) {
        return Float.isNaN(v) ? 0f : Math.max(0f, Math.min(1f, v));
    }

    /** The player placed it by hand. */
    public boolean placed() {
        return data().x >= 0 && data().y >= 0;
    }

    /** How big the module is drawn: its own size × the size of the whole HUD. */
    public float size() {
        return scale.value() * Hammer.config().hudScaleInUse();
    }

    public float scaledW() {
        return w * size();
    }

    public float scaledH() {
        return h * size();
    }

    /** Top-left corner on a HUD of sw × sh GUI pixels. */
    public float left(float sw) {
        return placed() ? clamp01(data().x) * Math.max(0, sw - scaledW()) : autoX;
    }

    public float top(float sh) {
        return placed() ? clamp01(data().y) * Math.max(0, sh - scaledH()) : autoY;
    }

    /** Stores a dragged top-left corner as shares of the free space. */
    public void moveTo(float px, float py, float sw, float sh) {
        data().x = sw > scaledW() ? clamp01(px / (sw - scaledW())) : 0f;
        data().y = sh > scaledH() ? clamp01(py / (sh - scaledH())) : 0f;
        Hammer.config().markDirty();
    }

    public void resetPosition() {
        data().x = -1f;
        data().y = -1f;
        Hammer.config().markDirty();
    }
}
