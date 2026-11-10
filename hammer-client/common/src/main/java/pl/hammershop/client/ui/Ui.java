package pl.hammershop.client.ui;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Gfx;

import java.util.List;

/**
 * One frame of one of our screens: the painter, the input of this frame and the widgets (buttons, switches,
 * sliders, text fields, dropdowns, colour pickers, scroll areas). Everything is in "UI units": the screen is always
 * about 480–640 units tall, whatever the window size or the game's GUI scale, so the menus look the same everywhere.
 */
public final class Ui {
    public final Draw d;
    public final UiState st;
    /** Screen size in UI units. */
    public final float w;
    public final float h;
    /** Mouse position in UI units. */
    public final float mx;
    public final float my;
    /** Seconds since the previous frame / since the screen opened. */
    public final float dt;
    public final float time;
    public final boolean down;
    public boolean pressed;
    public final boolean released;
    public boolean rightPressed;
    public float scroll;
    private String typed;
    private final List<int[]> keys;
    private float offY;
    private boolean inPopup;
    private String tooltip;
    private final java.util.ArrayDeque<float[]> scrolls = new java.util.ArrayDeque<>();
    private final java.util.ArrayDeque<String> scrollIds = new java.util.ArrayDeque<>();

    /** UI units → GUI pixels for a window of this size. */
    public static float uiScale(Gfx g) {
        double realW = g.width() * g.guiScale();
        double realH = g.height() * g.guiScale();
        double fit = Math.min(realH / 480.0, realW / 800.0);
        double real = fit >= 1 ? Math.min(6, Math.floor(fit * 2) / 2) : Math.max(0.4, fit);
        return (float) (real / g.guiScale());
    }

    public Ui(Gfx g, UiState st, Input input, float mouseGuiX, float mouseGuiY) {
        this.d = new Draw(g);
        this.st = st;
        float s = uiScale(g);
        this.w = g.width() / s;
        this.h = g.height() / s;
        this.mx = mouseGuiX / s;
        this.my = mouseGuiY / s;
        long now = System.nanoTime();
        this.dt = st.lastFrame == 0 ? 0.016f : Math.min(0.1f, (now - st.lastFrame) / 1e9f);
        st.lastFrame = now;
        this.time = st.age();
        Input.Frame f = input.take();
        this.down = f.down()[0];
        this.pressed = f.pressed()[0];
        this.released = f.released()[0];
        this.rightPressed = f.pressed()[1];
        this.scroll = f.scroll();
        this.typed = f.typed();
        this.keys = f.keys();
        if (!down && !pressed) st.active = null;
        d.push();
        d.scale(s);
    }

    /** Finishes the frame: popups and the tooltip are drawn on top of everything. */
    public void end() {
        if (st.popup != null) {
            // A press outside the popup closes it (and does nothing else).
            boolean outside = st.popupRect != null && !inside(mx, my, st.popupRect[0], st.popupRect[1], st.popupRect[2], st.popupRect[3]);
            if (pressed && outside) {
                st.closePopup();
                pressed = false;
            } else {
                inPopup = true;
                st.popupRect = st.popup.draw(this);
                inPopup = false;
            }
        }
        if (tooltip != null) drawTooltip();
        d.pop();
    }

    // ───────────── state helpers ─────────────

    private static boolean inside(float px, float py, float x, float y, float w, float h) {
        return px >= x && px < x + w && py >= y && py < y + h;
    }

    private boolean blocked() {
        return !inPopup && st.popup != null && st.popupRect != null && inside(mx, my, st.popupRect[0], st.popupRect[1], st.popupRect[2], st.popupRect[3]);
    }

    /** Mouse over a rectangle (respects clipping, scrolling and open popups). */
    public boolean hover(float x, float y, float w, float h) {
        float cy = my + offY;
        return inside(mx, cy, x, y, w, h) && d.visible(mx, cy) && !blocked() && (inPopup || st.popup == null);
    }

    /** Left press this frame inside the rectangle. */
    public boolean click(float x, float y, float w, float h) {
        if (pressed && hover(x, y, w, h)) {
            pressed = false;
            return true;
        }
        return false;
    }

    /** A value that eases towards `target` (speed ≈ 1/seconds·8). */
    public float anim(String id, float target, float speed) {
        Float cur = st.anims.get(id);
        if (cur == null || !Hammer.animations()) {
            st.anims.put(id, target);
            return target;
        }
        float v = cur + (target - cur) * (1f - (float) Math.exp(-speed * dt));
        if (Math.abs(v - target) < 0.002f) v = target;
        st.anims.put(id, v);
        return v;
    }

    public float hoverAnim(String id, boolean hover) {
        return anim(id, hover ? 1f : 0f, 18f);
    }

    /** 0→1 once after the screen opened, delayed by `delay` seconds (for entrance animations). */
    public float enter(float delay, float duration) {
        if (!Hammer.animations()) return 1f;
        float t = Math.max(0f, Math.min(1f, (time - delay) / duration));
        return 1f - (1f - t) * (1f - t) * (1f - t);
    }

    public void tooltip(String text) {
        tooltip = text;
    }

    private void drawTooltip() {
        float tw = d.textWidth(tooltip, 8, Font.MEDIUM) + 14;
        float x = Math.min(mx + 10, w - tw - 4);
        float y = Math.min(my + 14, h - 22);
        d.shadow(x, y, tw, 18, 6, 0x66000000);
        d.panel(x, y, tw, 18, 5, Theme.PANEL_SOLID, Theme.LINE_STRONG);
        d.textIn(tooltip, x + 7, y, 18, 8, Theme.TEXT, Font.MEDIUM);
    }

    private void sound() {
        Hammer.platform().clickSound();
    }

    // ───────────── widgets ─────────────

    public enum Style {
        PRIMARY, SECONDARY, GHOST, DISCORD, DANGER
    }

    public boolean button(String id, String label, String icon, float x, float y, float w, float h, Style style) {
        return button(id, label, icon, x, y, w, h, style, true);
    }

    /** A button; returns true when it was pressed this frame. */
    public boolean button(String id, String label, String icon, float x, float y, float w, float h, Style style, boolean enabled) {
        boolean hot = enabled && hover(x, y, w, h);
        float a = hoverAnim(id, hot);
        float r = Math.min(7, h / 2f);
        int text;
        switch (style) {
            case PRIMARY -> {
                if (enabled) d.shadow(x, y + 2, w, h, 5 + 4 * a, Draw.alpha(Theme.accent(), 0.25f + 0.25f * a));
                d.rgradient(x, y, w, h, r, Draw.mix(Theme.accentLight(), 0xFFFFFFFF, 0.25f * a), Draw.mix(Theme.accentDark(), Theme.accent(), a));
                text = Theme.INK;
            }
            case DISCORD -> {
                d.shadow(x, y + 2, w, h, 5 + 4 * a, Draw.alpha(Theme.DISCORD, 0.25f + 0.25f * a));
                d.rgradient(x, y, w, h, r, Draw.mix(Theme.DISCORD_LIGHT, 0xFFFFFFFF, 0.2f * a), Draw.mix(0xFF4752C4, Theme.DISCORD, a));
                text = 0xFFFFFFFF;
            }
            case DANGER -> {
                d.panel(x, y, w, h, r, Draw.mix(Theme.CARD, 0xFF4A1C1C, a), Draw.mix(Theme.LINE, Theme.ERR, a));
                text = Draw.mix(Theme.TEXT, 0xFFFFC9C9, a);
            }
            case GHOST -> {
                d.rrect(x, y, w, h, r, Draw.alpha(0xFFFFFFFF, 0.07f * a));
                text = Draw.mix(Theme.MUTED, Theme.TEXT, a);
            }
            default -> {
                d.panel(x, y, w, h, r, Draw.mix(Theme.CARD, Theme.CARD_HOVER, a), Draw.mix(Theme.LINE, Theme.accent(), a * 0.8f));
                text = Theme.TEXT;
            }
        }
        if (!enabled) text = Theme.DIM;
        float size = Math.min(9.5f, h * 0.42f);
        float tw = label.isEmpty() ? 0 : d.textWidth(label, size, Font.BOLD);
        float iw = icon != null ? size * 1.25f : 0;
        float gap = icon != null && !label.isEmpty() ? size * 0.55f : 0;
        float cx = x + (w - tw - iw - gap) / 2f;
        if (icon != null) d.icon(icon, cx, y + (h - iw) / 2f, iw, text);
        if (!label.isEmpty()) d.textIn(label, cx + iw + gap, y, h, size, text, Font.BOLD);
        if (enabled && click(x, y, w, h)) {
            sound();
            return true;
        }
        return false;
    }

    /** A round icon-only button. */
    public boolean iconButton(String id, String icon, float x, float y, float size, String tip) {
        boolean hot = hover(x, y, size, size);
        float a = hoverAnim(id, hot);
        d.rrect(x, y, size, size, size * 0.3f, Draw.alpha(0xFFFFFFFF, 0.04f + 0.08f * a));
        d.icon(icon, x + size * 0.24f, y + size * 0.24f, size * 0.52f, Draw.mix(Theme.MUTED, Theme.TEXT, a));
        if (hot && tip != null) tooltip(tip);
        if (click(x, y, size, size)) {
            sound();
            return true;
        }
        return false;
    }

    public static final float TOGGLE_W = 30;
    public static final float TOGGLE_H = 16;

    /** An on/off switch; returns the (possibly changed) value. */
    public boolean toggle(String id, boolean value, float x, float y) {
        boolean hot = hover(x - 2, y - 2, TOGGLE_W + 4, TOGGLE_H + 4);
        float a = anim(id, value ? 1f : 0f, 20f);
        d.rrect(x, y, TOGGLE_W, TOGGLE_H, TOGGLE_H / 2f, Draw.mix(0xFF3A2E24, Theme.accent(), a));
        if (hot) d.rrect(x, y, TOGGLE_W, TOGGLE_H, TOGGLE_H / 2f, 0x18FFFFFF);
        float kx = x + 8 + (TOGGLE_W - 16) * a;
        d.circle(kx, y + TOGGLE_H / 2f, 6, Draw.mix(0xFFCDBBAA, 0xFFFFFFFF, a));
        if (click(x - 2, y - 2, TOGGLE_W + 4, TOGGLE_H + 4)) {
            sound();
            return !value;
        }
        return value;
    }

    /** A slider; returns the value (snapped to `step`). */
    public float slider(String id, float value, float min, float max, float step, float x, float y, float w) {
        float h = 14;
        boolean hot = hover(x - 4, y, w + 8, h);
        if (hot && pressed) {
            st.active = id;
            pressed = false;
        }
        if (id.equals(st.active)) {
            float t = Math.max(0f, Math.min(1f, (mx - x) / w));
            value = min + t * (max - min);
            if (step > 0) value = Math.round(value / step) * step;
            value = Math.max(min, Math.min(max, value));
        }
        float t = max > min ? (value - min) / (max - min) : 0;
        float a = hoverAnim(id, hot || id.equals(st.active));
        d.rrect(x, y + 5, w, 4, 2, 0xFF3A2E24);
        d.rrect(x, y + 5, w * t, 4, 2, Theme.accent());
        d.circle(x + w * t, y + 7, 5 + a, 0xFFFFFFFF);
        d.circle(x + w * t, y + 7, 2.5f, Theme.accent());
        return value;
    }

    /** A one-line text field; returns the (possibly edited) text. */
    public String textField(String id, String value, String placeholder, String icon, float x, float y, float w, float h) {
        boolean focus = id.equals(st.focus);
        if (pressed && d.visible(mx, my + offY) && !blocked()) {
            if (hover(x, y, w, h)) {
                st.focus = id;
                focus = true;
                pressed = false;
            } else if (focus) {
                st.focus = null;
                focus = false;
            }
        }
        if (focus) {
            if (!typed.isEmpty()) {
                value = (value + typed).substring(0, Math.min(64, value.length() + typed.length()));
                typed = "";
            }
            for (int[] k : keys) {
                boolean ctrl = (k[1] & Input.MOD_CTRL) != 0;
                if (k[0] == Input.KEY_BACKSPACE || k[0] == Input.KEY_DELETE) value = ctrl || value.isEmpty() ? "" : value.substring(0, value.length() - 1);
                else if (k[0] == Input.KEY_V && ctrl) {
                    String clip = Hammer.platform().clipboard();
                    if (clip != null) value = (value + clip.replaceAll("[\\r\\n\\t]", " ")).substring(0, Math.min(64, value.length() + clip.length()));
                } else if (k[0] == Input.KEY_ENTER) st.focus = null;
            }
        }
        float a = anim(id, focus ? 1f : 0f, 18f);
        d.panel(x, y, w, h, 6, Theme.FIELD, Draw.mix(Theme.LINE, Theme.accent(), a));
        float tx = x + 9;
        if (icon != null) {
            d.icon(icon, tx, y + (h - 9) / 2f, 9, Theme.DIM);
            tx += 15;
        }
        if (value.isEmpty() && !focus) d.textIn(placeholder, tx, y, h, 8.5f, Theme.DIM, Font.MEDIUM);
        else {
            float end = d.textIn(d.ellipsis(value, w - (tx - x) - 12, 8.5f, Font.MEDIUM), tx, y, h, 8.5f, Theme.TEXT, Font.MEDIUM);
            if (focus && (time * 2) % 2 < 1.2f) d.fill(end + 1, y + h / 2f - 5, 1, 10, Theme.accent());
        }
        return value;
    }

    public boolean focused(String id) {
        return id.equals(st.focus);
    }

    /** A dropdown; returns the selected index. */
    public int choice(String id, String[] labels, int index, float x, float y, float w, float h) {
        Object result = st.results.remove(id);
        if (result instanceof Integer i) index = i;
        index = Math.max(0, Math.min(labels.length - 1, index));
        boolean open = st.popup != null && st.popup.id().equals(id);
        boolean hot = hover(x, y, w, h);
        float a = hoverAnim(id, hot || open);
        d.panel(x, y, w, h, 6, Theme.FIELD, Draw.mix(Theme.LINE, Theme.accent(), a));
        d.textIn(d.ellipsis(labels[index], w - 26, 8.5f, Font.MEDIUM), x + 9, y, h, 8.5f, Theme.TEXT, Font.MEDIUM);
        d.icon("down", x + w - 16, y + (h - 8) / 2f, 8, Theme.MUTED);
        if (click(x, y, w, h)) {
            sound();
            final float px = x;
            final float py = y - offY + h + 3;
            final float pw = w;
            final int current = index;
            st.popup = new UiState.Popup() {
                public String id() {
                    return id;
                }

                public float[] draw(Ui ui) {
                    float rowH = 18;
                    float ph = labels.length * rowH + 8;
                    float top = py + ph > ui.h - 6 ? Math.max(6, py - ph - h - 6) : py;
                    ui.d.shadow(px, top, pw, ph, 8, 0x80000000);
                    ui.d.panel(px, top, pw, ph, 7, Theme.PANEL_SOLID, Theme.LINE_STRONG);
                    for (int i = 0; i < labels.length; i++) {
                        float ry = top + 4 + i * rowH;
                        boolean over = ui.hover(px + 3, ry, pw - 6, rowH);
                        if (over || i == current) ui.d.rrect(px + 3, ry, pw - 6, rowH, 5, over ? 0x22FFFFFF : Draw.alpha(Theme.accent(), 0.16f));
                        ui.d.textIn(labels[i], px + 10, ry, rowH, 8.5f, i == current ? Theme.accentLight() : Theme.TEXT, Font.MEDIUM);
                        if (ui.click(px + 3, ry, pw - 6, rowH)) {
                            ui.sound();
                            ui.st.results.put(id, i);
                            ui.st.closePopup();
                        }
                    }
                    return new float[] {px, top, pw, ph};
                }
            };
        }
        return index;
    }

    public static final int[] SWATCHES = {
            0xFFFFFFFF, 0xFFF7EFE7, 0xFFB9A797, 0xFF000000, 0xFFFF9F43, 0xFFFFC83D, 0xFFFF6B6B, 0xFFFF7EB6,
            0xFFB18CFF, 0xFF5CA8FF, 0xFF4DD9E6, 0xFF5EE08D, 0xFFA3E635, 0xFFF97316, 0xFFE11D48, 0xFF64748B,
    };

    /**
     * A colour swatch that opens a picker (presets, hue, opacity, optional rainbow). `value` is ARGB;
     * the result is {argb, chroma ? 1 : 0}.
     */
    public int[] color(String id, int value, boolean chroma, boolean allowChroma, float x, float y) {
        Object result = st.results.get(id);
        if (result instanceof int[] r) {
            value = r[0];
            chroma = r[1] != 0;
        }
        float w = 30;
        float h = 16;
        boolean open = st.popup != null && st.popup.id().equals(id);
        if (!open) st.results.remove(id);
        boolean hot = hover(x, y, w, h);
        float a = hoverAnim(id, hot || open);
        int shown = chroma ? Draw.hsv(time * 0.25f, 0.75f, 1f) : value | 0xFF000000;
        d.rrect(x, y, w, h, 5, Draw.mix(Theme.LINE_STRONG, 0xFFFFFFFF, a));
        d.rrect(x + 1, y + 1, w - 2, h - 2, 4, shown);
        if (click(x, y, w, h)) {
            sound();
            final float px = Math.min(x - 150 + w, this.w - 176);
            final float py = y - offY + h + 4;
            final int[] cur = {value, chroma ? 1 : 0};
            st.results.put(id, cur);
            st.popup = new UiState.Popup() {
                public String id() {
                    return id;
                }

                public float[] draw(Ui ui) {
                    float pw = 170;
                    float ph = allowChroma ? 150 : 128;
                    float top = py + ph > ui.h - 6 ? Math.max(6, py - ph - 24) : py;
                    Draw dd = ui.d;
                    dd.shadow(px, top, pw, ph, 8, 0x80000000);
                    dd.panel(px, top, pw, ph, 8, Theme.PANEL_SOLID, Theme.LINE_STRONG);
                    float cx = px + 10;
                    float cy = top + 10;
                    for (int i = 0; i < SWATCHES.length; i++) {
                        float sx = cx + (i % 8) * 19;
                        float sy = cy + (i / 8) * 19;
                        boolean over = ui.hover(sx, sy, 16, 16);
                        boolean sel = cur[1] == 0 && (cur[0] & 0xFFFFFF) == (SWATCHES[i] & 0xFFFFFF);
                        if (sel || over) dd.rrect(sx - 1.5f, sy - 1.5f, 19, 19, 6, sel ? 0xFFFFFFFF : 0x80FFFFFF);
                        dd.rrect(sx, sy, 16, 16, 5, SWATCHES[i]);
                        if (ui.click(sx, sy, 16, 16)) {
                            ui.sound();
                            cur[0] = (cur[0] & 0xFF000000) | (SWATCHES[i] & 0xFFFFFF);
                            cur[1] = 0;
                        }
                    }
                    float sy = cy + 46;
                    dd.text(Hammer.t("ui.hue"), cx, sy, 7.5f, Theme.MUTED, Font.MEDIUM);
                    float hy = sy + 12;
                    dd.rrect(cx - 1, hy - 1, pw - 18, 10, 4, 0x40FFFFFF);
                    dd.hueBar(cx, hy, pw - 20, 8);
                    if (ui.hover(cx - 3, hy - 3, pw - 14, 14) && ui.pressed) {
                        ui.st.active = id + ".hue";
                        ui.pressed = false;
                    }
                    if ((id + ".hue").equals(ui.st.active)) {
                        float t = Math.max(0f, Math.min(1f, (ui.mx - cx) / (pw - 20)));
                        cur[0] = (cur[0] & 0xFF000000) | (Draw.hsv(t, 0.85f, 1f) & 0xFFFFFF);
                        cur[1] = 0;
                    }
                    if (cur[1] == 0) dd.circle(cx + Draw.hue(cur[0]) * (pw - 20), hy + 4, 4, 0xFFFFFFFF);
                    float oy = hy + 16;
                    int al = (cur[0] >>> 24) & 0xFF;
                    dd.text(Hammer.t("ui.opacity") + "  " + Math.round(al / 2.55f) + "%", cx, oy, 7.5f, Theme.MUTED, Font.MEDIUM);
                    float nv = ui.slider(id + ".alpha", al, 40, 255, 1, cx + 2, oy + 11, pw - 24);
                    cur[0] = (Math.round(nv) << 24) | (cur[0] & 0xFFFFFF);
                    if (allowChroma) {
                        float ry = oy + 32;
                        dd.textIn(Hammer.t("ui.chroma"), cx, ry, 16, 8, Theme.TEXT, Font.MEDIUM);
                        cur[1] = ui.toggle(id + ".chroma", cur[1] != 0, px + pw - 40, ry) ? 1 : 0;
                    }
                    return new float[] {px, top, pw, ph};
                }
            };
        }
        return new int[] {value, chroma ? 1 : 0};
    }

    // ───────────── scrolling ─────────────

    /** Starts a scrollable area; draw its content at absolute coordinates, then call {@link #endScroll}. */
    public void beginScroll(String id, float x, float y, float w, float h, float contentH) {
        float max = Math.max(0, contentH - h);
        float target = st.scrollTarget.getOrDefault(id, 0f);
        if (scroll != 0 && hover(x, y, w, h)) {
            target -= scroll * 30;
            scroll = 0;
        }
        target = Math.max(0, Math.min(max, target));
        st.scrollTarget.put(id, target);
        float cur = st.scroll.getOrDefault(id, 0f);
        cur += (target - cur) * (Hammer.animations() ? 1f - (float) Math.exp(-20 * dt) : 1f);
        if (Math.abs(cur - target) < 0.3f) cur = target;
        cur = Math.max(0, Math.min(max, cur));
        st.scroll.put(id, cur);
        d.clip(x, y, w, h);
        d.push();
        d.translate(0, -cur);
        offY += cur;
        scrolls.push(new float[] {x, y, w, h, contentH, cur});
        scrollIds.push(id);
    }

    public void endScroll() {
        float[] s = scrolls.pop();
        scrollIds.pop();
        offY -= s[5];
        d.pop();
        d.unclip();
        float max = s[4] - s[3];
        if (max > 0.5f) {
            float thumb = Math.max(18, s[3] * s[3] / s[4]);
            float ty = s[1] + (s[3] - thumb) * (s[5] / max);
            d.rrect(s[0] + s[2] - 3, ty, 3, thumb, 1.5f, 0x50FFC27E);
        }
    }

    public void resetScroll(String id) {
        st.scroll.remove(id);
        st.scrollTarget.remove(id);
    }
}
