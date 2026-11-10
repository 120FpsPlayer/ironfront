package pl.hammershop.client.ui;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import pl.hammershop.client.api.Gfx;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Hammer Client's painter on top of {@link Gfx}: rounded panels, soft shadows, glows, icons and the smooth font –
 * all made of tinted sprites (ui.png, icons.png, font atlases), so they look the same on every Minecraft version.
 * It also tracks its own transform (uniform scale + translation), which gives correct clipping and sharp fonts.
 */
public final class Draw {
    private static final int UI = 256; // ui.png size
    private static final Map<String, Integer> ICONS = new HashMap<>();
    private static int iconCell = 64;
    private static int iconCols = 8;
    private static int iconW = 512;
    private static int iconH = 512;

    static {
        try (InputStream in = Draw.class.getResourceAsStream("/assets/hammerclient/icons.json")) {
            if (in != null) {
                JsonObject o = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
                iconCell = o.get("cell").getAsInt();
                iconCols = o.get("cols").getAsInt();
                iconW = o.get("width").getAsInt();
                iconH = o.get("height").getAsInt();
                for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("icons").entrySet()) ICONS.put(e.getKey(), e.getValue().getAsInt());
            }
        } catch (Exception e) {
            throw new IllegalStateException("icons.json", e);
        }
    }

    public final Gfx g;
    private float scale = 1f;
    private float tx;
    private float ty;
    private final Deque<float[]> stack = new ArrayDeque<>();
    private final Deque<int[]> clips = new ArrayDeque<>();

    public Draw(Gfx g) {
        this.g = g;
    }

    // ───────────── transform ─────────────

    public void push() {
        stack.push(new float[] {scale, tx, ty});
        g.push();
    }

    public void pop() {
        float[] s = stack.pop();
        scale = s[0];
        tx = s[1];
        ty = s[2];
        g.pop();
    }

    /** How deep the transform and clip stacks are right now – see {@link #rewind}. */
    public int[] mark() {
        return new int[] {stack.size(), clips.size()};
    }

    /** After a failure in the middle of drawing: drops every push and clip made since {@link #mark}. */
    public void rewind(int[] mark) {
        while (clips.size() > mark[1]) unclip();
        while (stack.size() > mark[0]) pop();
    }

    /** After a failure: hands the game back a clean state (no clip, no transform of ours left). */
    public void unwind() {
        rewind(new int[] {0, 0});
    }

    public void translate(float x, float y) {
        tx += x * scale;
        ty += y * scale;
        g.translate(x, y);
    }

    public void scale(float s) {
        scale *= s;
        g.scale(s, s);
    }

    /** Current scale relative to GUI pixels. */
    public float scale() {
        return scale;
    }

    /** Real pixels per unit of the current space. */
    public float unit() {
        return (float) (g.guiScale() * scale);
    }

    /** Clips to a rectangle of the current space (nested clips intersect). */
    public void clip(float x, float y, float w, float h) {
        int x1 = (int) Math.floor(x * scale + tx);
        int y1 = (int) Math.floor(y * scale + ty);
        int x2 = (int) Math.ceil((x + w) * scale + tx);
        int y2 = (int) Math.ceil((y + h) * scale + ty);
        int[] top = clips.peek();
        if (top != null) {
            x1 = Math.max(x1, top[0]);
            y1 = Math.max(y1, top[1]);
            x2 = Math.min(x2, top[2]);
            y2 = Math.min(y2, top[3]);
        }
        if (x2 < x1) x2 = x1;
        if (y2 < y1) y2 = y1;
        clips.push(new int[] {x1, y1, x2, y2});
        g.clip(x1, y1, x2, y2);
    }

    public void unclip() {
        clips.pop();
        g.unclip();
    }

    /** Whether a point of the current space is inside the active clip. */
    public boolean visible(float x, float y) {
        int[] top = clips.peek();
        if (top == null) return true;
        float gx = x * scale + tx;
        float gy = y * scale + ty;
        return gx >= top[0] && gx < top[2] && gy >= top[1] && gy < top[3];
    }

    // ───────────── shapes ─────────────

    public void fill(float x, float y, float w, float h, int argb) {
        if (w <= 0 || h <= 0 || (argb >>> 24) == 0) return;
        g.fill(Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h), argb);
    }

    public void gradient(float x, float y, float w, float h, int top, int bottom) {
        if (w <= 0 || h <= 0) return;
        g.gradient(Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h), top, bottom);
    }

    private void sprite(float x, float y, float w, float h, float u, float v, int uw, int vh, int argb) {
        if (w <= 0 || h <= 0 || (argb >>> 24) == 0) return;
        g.image("ui", Math.round(x), Math.round(y), Math.round(x + w) - Math.round(x), Math.round(y + h) - Math.round(y), u, v, uw, vh, UI, UI, argb);
    }

    /** Filled rectangle with rounded corners. */
    public void rrect(float x, float y, float w, float h, float r, int argb) {
        if (w <= 0 || h <= 0 || (argb >>> 24) == 0) return;
        r = Math.max(0, Math.min(r, Math.min(w, h) / 2f));
        int ri = Math.round(r);
        if (ri <= 0) {
            fill(x, y, w, h, argb);
            return;
        }
        int x0 = Math.round(x);
        int y0 = Math.round(y);
        int x1 = Math.round(x + w);
        int y1 = Math.round(y + h);
        // corners (quarters of the disc sprite), then the cross in between
        g.image("ui", x0, y0, ri, ri, 0, 0, 32, 32, UI, UI, argb);
        g.image("ui", x1 - ri, y0, ri, ri, 32, 0, 32, 32, UI, UI, argb);
        g.image("ui", x0, y1 - ri, ri, ri, 0, 32, 32, 32, UI, UI, argb);
        g.image("ui", x1 - ri, y1 - ri, ri, ri, 32, 32, 32, 32, UI, UI, argb);
        if (x1 - ri > x0 + ri) g.fill(x0 + ri, y0, x1 - ri, y1, argb);
        if (y1 - ri > y0 + ri) {
            g.fill(x0, y0 + ri, x0 + ri, y1 - ri, argb);
            g.fill(x1 - ri, y0 + ri, x1, y1 - ri, argb);
        }
    }

    /** Rounded panel with a 1-unit border (fill should be nearly opaque). */
    public void panel(float x, float y, float w, float h, float r, int fill, int border) {
        if ((border >>> 24) != 0) {
            rrect(x, y, w, h, r, border);
            rrect(x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1), fill);
        } else rrect(x, y, w, h, r, fill);
    }

    /** Vertical gradient with rounded corners (top colour on the upper half's corners, bottom on the lower). */
    public void rgradient(float x, float y, float w, float h, float r, int top, int bottom) {
        int ri = Math.round(Math.max(0, Math.min(r, Math.min(w, h) / 2f)));
        if (ri <= 0) {
            gradient(x, y, w, h, top, bottom);
            return;
        }
        int x0 = Math.round(x);
        int y0 = Math.round(y);
        int x1 = Math.round(x + w);
        int y1 = Math.round(y + h);
        g.image("ui", x0, y0, ri, ri, 0, 0, 32, 32, UI, UI, top);
        g.image("ui", x1 - ri, y0, ri, ri, 32, 0, 32, 32, UI, UI, top);
        g.image("ui", x0, y1 - ri, ri, ri, 0, 32, 32, 32, UI, UI, bottom);
        g.image("ui", x1 - ri, y1 - ri, ri, ri, 32, 32, 32, 32, UI, UI, bottom);
        g.fill(x0 + ri, y0, x1 - ri, y0 + ri, top);
        g.fill(x0 + ri, y1 - ri, x1 - ri, y1, bottom);
        g.gradient(x0, y0 + ri, x1, y1 - ri, top, bottom);
    }

    /** Soft drop shadow around a rectangle. */
    public void shadow(float x, float y, float w, float h, float size, int argb) {
        float c = Math.min(size * 2, Math.min(w, h) / 2f + size);
        float ox = x - size;
        float oy = y - size;
        float ow = w + size * 2;
        float oh = h + size * 2;
        // 9-slice of the 96×96 blur at (64, 0): 40 px corners, 16 px centre
        float[] us = {64, 104, 120};
        int[] uw = {40, 16, 40};
        float[] vs = {0, 40, 56};
        float[] xs = {ox, ox + c, ox + ow - c};
        float[] ws = {c, ow - 2 * c, c};
        float[] ys = {oy, oy + c, oy + oh - c};
        float[] hs = {c, oh - 2 * c, c};
        for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) sprite(xs[i], ys[j], ws[i], hs[j], us[i], vs[j], uw[i], uw[j], argb);
    }

    public void circle(float cx, float cy, float r, int argb) {
        sprite(cx - r, cy - r, r * 2, r * 2, 0, 0, 64, 64, argb);
    }

    public void ring(float cx, float cy, float r, int argb) {
        sprite(cx - r, cy - r, r * 2, r * 2, 0, 96, 64, 64, argb);
    }

    public void check(float x, float y, float size, int argb) {
        sprite(x, y, size, size, 64, 96, 64, 64, argb);
    }

    /** Radial glow centred on (cx, cy). */
    public void glow(float cx, float cy, float r, int argb) {
        sprite(cx - r, cy - r, r * 2, r * 2, 160, 0, 96, 96, argb);
    }

    /** Horizontal fade: opaque at the left, transparent at the right (flip = the other way round). */
    public void fade(float x, float y, float w, float h, int argb, boolean flip) {
        sprite(x, y, w, h, flip ? 128.5f : 0.5f, flip ? 98 : 66, 63, 12, argb);
    }

    /** The hue spectrum (for colour sliders). */
    public void hueBar(float x, float y, float w, float h) {
        sprite(x, y, w, h, 0.5f, 82, 63, 12, 0xFFFFFFFF);
    }

    public void icon(String name, float x, float y, float size, int argb) {
        Integer i = ICONS.get(name);
        if (i == null || (argb >>> 24) == 0) return;
        g.image("icons", Math.round(x), Math.round(y), Math.round(size), Math.round(size), (i % iconCols) * iconCell, (i / iconCols) * iconCell, iconCell, iconCell, iconW, iconH, argb);
    }

    public static boolean hasIcon(String name) {
        return ICONS.containsKey(name);
    }

    /** A whole texture stretched into the rectangle. */
    public void image(String texture, int texW, int texH, float x, float y, float w, float h, int argb) {
        g.image(texture, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, texW, texH, texW, texH, argb);
    }

    /** A texture cropped to cover the rectangle (like CSS background-size: cover), shifted by (px, py) in −1…1. */
    public void cover(String texture, int texW, int texH, float x, float y, float w, float h, float zoom, float px, float py, int argb) {
        float target = w / h;
        float source = (float) texW / texH;
        float uw = texW;
        float vh = texH;
        if (target > source) vh = texW / target;
        else uw = texH * target;
        uw /= zoom;
        vh /= zoom;
        float u = (texW - uw) / 2f * (1 + px);
        float v = (texH - vh) / 2f * (1 + py);
        g.image(texture, Math.round(x), Math.round(y), Math.round(w), Math.round(h), u, v, Math.round(uw), Math.round(vh), texW, texH, argb);
    }

    // ───────────── text ─────────────

    public float textWidth(String text, float size, Font font) {
        Font.Atlas a = font.atlas(size * unit());
        return a.width(text) * size / a.size;
    }

    /** Height of a line of text of this size. */
    public float lineHeight(float size, Font font) {
        Font.Atlas a = font.atlas(size * unit());
        return (a.ascent + a.descent) * size / a.size;
    }

    /** Draws text with its line box starting at (x, y). Returns the x after the last glyph. */
    public float text(String text, float x, float y, float size, int argb, Font font) {
        if (text.isEmpty() || (argb >>> 24) == 0) return x;
        Font.Atlas a = font.atlas(size * unit());
        float k = size / a.size;
        push();
        translate(x, y);
        scale(k);
        float pen = 0;
        for (int i = 0; i < text.length(); i++) {
            float[] gl = a.glyph(text.charAt(i));
            if (gl[2] > 0) g.image(a.texture, Math.round(pen + gl[4]), Math.round(gl[5]), (int) gl[2], (int) gl[3], gl[0], gl[1], (int) gl[2], (int) gl[3], a.texW, a.texH, argb);
            pen += gl[6];
        }
        pop();
        return x + pen * k;
    }

    public void textCentered(String text, float cx, float y, float size, int argb, Font font) {
        text(text, cx - textWidth(text, size, font) / 2f, y, size, argb, font);
    }

    public void textRight(String text, float right, float y, float size, int argb, Font font) {
        text(text, right - textWidth(text, size, font), y, size, argb, font);
    }

    /** Text vertically centred in a box of height h. */
    public float textIn(String text, float x, float y, float h, float size, int argb, Font font) {
        return text(text, x, y + (h - lineHeight(size, font)) / 2f, size, argb, font);
    }

    public String ellipsis(String text, float maxWidth, float size, Font font) {
        if (textWidth(text, size, font) <= maxWidth) return text;
        String s = text;
        while (s.length() > 1 && textWidth(s + "…", size, font) > maxWidth) s = s.substring(0, s.length() - 1);
        return s.stripTrailing() + "…";
    }

    /** Breaks text into lines no wider than maxWidth (at most maxLines; the last one gets an ellipsis). */
    public List<String> wrap(String text, float maxWidth, float size, Font font, int maxLines) {
        List<String> lines = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (String word : text.split(" ")) {
            String candidate = line.isEmpty() ? word : line + " " + word;
            if (textWidth(candidate, size, font) <= maxWidth || line.isEmpty()) {
                line.setLength(0);
                line.append(candidate);
            } else {
                lines.add(line.toString());
                line.setLength(0);
                line.append(word);
                if (lines.size() == maxLines) break;
            }
        }
        if (lines.size() < maxLines && !line.isEmpty()) lines.add(line.toString());
        else if (lines.size() == maxLines && !line.isEmpty()) lines.set(maxLines - 1, ellipsis(lines.get(maxLines - 1) + " " + line, maxWidth, size, font));
        return lines;
    }

    // ───────────── colours ─────────────

    public static int alpha(int argb, float a) {
        int al = Math.round(((argb >>> 24) & 0xFF) * Math.max(0f, Math.min(1f, a)));
        return (al << 24) | (argb & 0xFFFFFF);
    }

    public static int mix(int a, int b, float t) {
        t = Math.max(0f, Math.min(1f, t));
        int r = 0;
        for (int shift = 24; shift >= 0; shift -= 8) {
            int ca = (a >>> shift) & 0xFF;
            int cb = (b >>> shift) & 0xFF;
            r |= (Math.round(ca + (cb - ca) * t) & 0xFF) << shift;
        }
        return r;
    }

    public static int hsv(float h, float s, float v) {
        h = (h % 1f + 1f) % 1f;
        int i = (int) (h * 6);
        float f = h * 6 - i;
        float p = v * (1 - s);
        float q = v * (1 - f * s);
        float t = v * (1 - (1 - f) * s);
        float r;
        float gg;
        float b;
        switch (i % 6) {
            case 0 -> { r = v; gg = t; b = p; }
            case 1 -> { r = q; gg = v; b = p; }
            case 2 -> { r = p; gg = v; b = t; }
            case 3 -> { r = p; gg = q; b = v; }
            case 4 -> { r = t; gg = p; b = v; }
            default -> { r = v; gg = p; b = q; }
        }
        return 0xFF000000 | (Math.round(r * 255) << 16) | (Math.round(gg * 255) << 8) | Math.round(b * 255);
    }

    /** Hue (0–1) of a colour. */
    public static float hue(int rgb) {
        float r = ((rgb >> 16) & 0xFF) / 255f;
        float g = ((rgb >> 8) & 0xFF) / 255f;
        float b = (rgb & 0xFF) / 255f;
        float max = Math.max(r, Math.max(g, b));
        float min = Math.min(r, Math.min(g, b));
        if (max == min) return 0;
        float d = max - min;
        float h = max == r ? ((g - b) / d + (g < b ? 6 : 0)) : max == g ? (b - r) / d + 2 : (r - g) / d + 4;
        return h / 6f;
    }
}
