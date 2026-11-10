package pl.hammershop.client.api;

/**
 * Drawing surface of one frame, implemented once per Minecraft version (and by the offline preview renderer).
 * Coordinates are GUI-scaled pixels of the game, transformed by the matrix stack (push / translate / scale).
 * Colours are ARGB ints. Textures are named relative to assets/hammerclient/textures/ without ".png".
 */
public interface Gfx {
    /** Screen size in GUI-scaled pixels. */
    int width();

    int height();

    /** Real (framebuffer) pixels per GUI-scaled pixel. */
    double guiScale();

    void fill(int x1, int y1, int x2, int y2, int argb);

    /** Vertical gradient. */
    void gradient(int x1, int y1, int x2, int y2, int argbTop, int argbBottom);

    /** A tinted part of a texture: (u, v, uw, vh) in texture pixels of a texW × texH texture, drawn into (x, y, w, h). */
    void image(String texture, int x, int y, int w, int h, float u, float v, int uw, int vh, int texW, int texH, int argb);

    /** Minecraft's own font. */
    int mcTextWidth(String text);

    void mcText(String text, int x, int y, int argb, boolean shadow);

    /** A 16×16 item icon; `stack` is an opaque handle from {@link Game}. */
    void item(Object stack, int x, int y);

    void push();

    void pop();

    void translate(float x, float y);

    void scale(float sx, float sy);

    /** Clips to a rectangle given in untransformed GUI-scaled pixels (the matrix stack does not apply). */
    void clip(int x1, int y1, int x2, int y2);

    void unclip();
}
