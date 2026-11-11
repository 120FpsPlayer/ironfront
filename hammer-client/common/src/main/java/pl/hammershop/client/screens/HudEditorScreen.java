package pl.hammershop.client.screens;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Modules;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;
import pl.hammershop.client.ui.UiScreen;

import java.util.ArrayList;
import java.util.List;

/**
 * HUD editor: drag the modules where you want them. They snap to the screen edges, the centre and to each other.
 * Every module has its own size: click one to select it, then use the − / + buttons next to it, drag the handle in
 * its corner, or turn the mouse wheel over it. A right click opens its settings. Positions are kept as shares of
 * the screen, so the layout fits any window size.
 */
public class HudEditorScreen extends UiScreen {
    private static final float SNAP = 4f;

    private HudModule dragging;
    /** Pressed but not moved yet: a plain click only selects, it must not take the module out of its stack. */
    private HudModule pressedOn;
    private float pressX;
    private float pressY;
    private float grabX;
    private float grabY;
    /** The module whose size is being edited (clicked last), or null. */
    private HudModule selected;
    private boolean resizing;
    private float resizeFromScale;
    private float resizeFromDistance;
    private float resizeOriginX;
    private float resizeOriginY;

    public HudModule selected() {
        return selected;
    }

    /** Makes the selected module bigger (positive) or smaller; other modules keep their size. */
    public void resizeSelected(float delta) {
        if (selected != null) setScale(selected, selected.scale.value() + delta);
    }

    private static void setScale(HudModule m, float value) {
        float v = Math.round(Math.max(m.scale.min, Math.min(m.scale.max, value)) * 20f) / 20f;
        if (Math.abs(v - m.scale.value()) > 0.001f) m.scale.set(v);
    }
    private final List<float[]> guides = new ArrayList<>(); // {vertical ? 1 : 0, position}

    @Override
    public void closed() {
        Hammer.config().saveIfDirty();
    }

    @Override
    public boolean blursWorld() {
        return false; // you place the HUD over the game you see
    }

    @Override
    public void render(Ui ui) {
        Draw d = ui.d;
        boolean inWorld = Hammer.game().inWorld();
        if (inWorld) Backdrop.dim(ui, 0.35f);
        else Backdrop.menu(ui, false);

        float s = d.scale(); // UI units → GUI pixels
        float sw = d.g.width();
        float sh = d.g.height();
        float mx = ui.mx * s;
        float my = ui.my * s;

        // The centre panel (drawn last) – its place is needed first, so it can take clicks before the modules.
        float pw = 300;
        float ph = 134;
        float px = (ui.w - pw) / 2f;
        float py = Math.max(60, ui.h * 0.5f - ph / 2f); // the middle of the screen: no default HUD stack reaches it
        boolean overPanel = dragging == null && !resizing && ui.hover(px, py, pw, ph);

        // The selected module: its rectangle (GUI pixels), its size buttons (UI units) and the corner handle.
        if (selected != null && (!selected.enabled() || selected.w <= 0)) selected = null;
        float selX = 0;
        float selY = 0;
        float selW = 0;
        float selH = 0;
        float tbw = 92;
        float tbh = 22;
        float tbx = 0;
        float tby = 0;
        boolean overTools = false;
        boolean overHandle = false;
        if (selected != null) {
            selX = selected.left(sw);
            selY = selected.top(sh);
            selW = selected.scaledW();
            selH = selected.scaledH();
            // Beside the module (right, else left), so they never cover the module stacked below it; under or
            // above it only when it is too wide for that.
            tbx = (selX + selW) / s + 8;
            tby = (selY + selH / 2f) / s - tbh / 2f;
            if (tbx + tbw > ui.w - 2) tbx = selX / s - tbw - 8;
            if (tbx < 2) {
                tbx = Math.max(2, Math.min(ui.w - tbw - 2, (selX + selW / 2f) / s - tbw / 2f));
                tby = (selY + selH) / s + 6;
                if (tby + tbh > ui.h - 2) tby = selY / s - tbh - 6;
            }
            tby = Math.max(2, Math.min(ui.h - tbh - 2, tby));
            overTools = dragging == null && !resizing && ui.hover(tbx, tby, tbw, tbh);
            overHandle = dragging == null && !overTools && !overPanel && mx >= selX + selW - 5 && mx < selX + selW + 6 && my >= selY + selH - 5 && my < selY + selH + 6;
        }
        if (ui.pressed && overHandle) {
            resizing = true;
            resizeFromScale = selected.scale.value();
            resizeOriginX = selX;
            resizeOriginY = selY;
            resizeFromDistance = Math.max(6f, (float) Math.hypot(mx - selX, my - selY));
            ui.pressed = false;
        }
        if (resizing) {
            if (!ui.down || selected == null) {
                resizing = false;
                Hammer.config().markDirty();
            } else setScale(selected, resizeFromScale * (float) Math.hypot(mx - resizeOriginX, my - resizeOriginY) / resizeFromDistance);
        }

        d.push();
        d.scale(1f / s);
        // faint centre lines
        d.fill(sw / 2f - 0.5f, 0, 1, sh, 0x18FFFFFF);
        d.fill(0, sh / 2f - 0.5f, sw, 1, 0x18FFFFFF);
        Hammer.drawHud(d, true);

        HudModule hover = null;
        if (!overPanel && !overTools && !overHandle && !resizing) {
            for (int i = Modules.HUD.size() - 1; i >= 0; i--) {
                HudModule m = Modules.HUD.get(i);
                if (!m.enabled() || m.w <= 0) continue;
                float x = m.left(sw);
                float y = m.top(sh);
                if (mx >= x && mx < x + m.scaledW() && my >= y && my < y + m.scaledH()) {
                    hover = m;
                    break;
                }
            }
        }
        if (ui.pressed && hover != null) {
            pressedOn = hover;
            selected = hover;
            pressX = mx;
            pressY = my;
            grabX = mx - hover.left(sw);
            grabY = my - hover.top(sh);
            ui.pressed = false;
        } else if (ui.pressed && !overPanel && !overTools) selected = null; // a click on empty space
        if (pressedOn != null && dragging == null && ui.down && Math.hypot(mx - pressX, my - pressY) > 3) dragging = pressedOn;
        if (!ui.down) {
            pressedOn = null;
            if (dragging != null) {
                dragging = null;
                guides.clear();
                Hammer.config().markDirty();
            }
        }
        if (dragging != null) drag(dragging, mx - grabX, my - grabY, sw, sh);
        if (ui.scroll != 0 && hover != null) {
            setScale(hover, hover.scale.value() + (ui.scroll > 0 ? 0.05f : -0.05f));
            ui.scroll = 0;
        }
        if (ui.rightPressed && hover != null) {
            ModMenuScreen menu = new ModMenuScreen(hover);
            menu.parent = this;
            d.pop();
            Hammer.open(menu);
            return;
        }

        // outlines and guides
        for (HudModule m : Modules.HUD) {
            if (!m.enabled() || m.w <= 0) continue;
            float x = m.left(sw);
            float y = m.top(sh);
            float w = m.scaledW();
            float h = m.scaledH();
            boolean chosen = m == selected;
            boolean hot = m == hover || m == dragging || chosen;
            int c = chosen ? 0xFFFFFFFF : hot ? Theme.accentLight() : Draw.alpha(Theme.accent(), 0.55f);
            d.fill(x - 1, y - 1, w + 2, 1, c);
            d.fill(x - 1, y + h, w + 2, 1, c);
            d.fill(x - 1, y, 1, h, c);
            d.fill(x + w, y, 1, h, c);
            if (chosen) {
                // a second line and the corner handle that resizes it
                d.fill(x - 2, y - 2, w + 4, 1, Theme.accent());
                d.fill(x - 2, y + h + 1, w + 4, 1, Theme.accent());
                d.fill(x - 2, y - 1, 1, h + 2, Theme.accent());
                d.fill(x + w + 1, y - 1, 1, h + 2, Theme.accent());
                d.fill(x + w - 3, y + h - 3, 7, 7, 0xFF140E08);
                d.fill(x + w - 2, y + h - 2, 5, 5, overHandle || resizing ? 0xFFFFFFFF : Theme.accent());
            }
            // the selected module shows its size in the buttons next to it instead (the label would sit under them)
            if (hot && !(chosen && dragging == null)) {
                String label = m.name() + (Math.abs(m.scale.value() - 1f) > 0.01f ? "  " + Math.round(m.scale.value() * 100) + "%" : "");
                float lw = d.g.mcTextWidth(label) + 6;
                float lx = Math.max(0, Math.min(sw - lw, x));
                float ly = y - 12 < 0 ? y + h + 2 : y - 12;
                d.fill(lx, ly, lw, 11, 0xE0140E08);
                d.g.mcText(label, Math.round(lx + 3), Math.round(ly + 2), Theme.accentLight(), false);
            }
        }
        for (float[] gl : guides) {
            if (gl[0] == 1) d.fill(gl[1] - 0.5f, 0, 1, sh, Theme.accent());
            else d.fill(0, gl[1] - 0.5f, sw, 1, Theme.accent());
        }
        d.pop();

        // size buttons of the selected module (hidden while it is being moved)
        if (selected != null && dragging == null) {
            d.shadow(tbx, tby, tbw, tbh, 8, 0x73000000);
            d.panel(tbx, tby, tbw, tbh, 7, 0xF5140E08, Theme.LINE_STRONG);
            if (ui.button("size.minus", "-", null, tbx + 2, tby + 2, 24, tbh - 4, Ui.Style.GHOST, selected.scale.value() > selected.scale.min + 0.001f)) resizeSelected(-0.05f);
            d.textCentered(Math.round(selected.scale.value() * 100) + "%", tbx + tbw / 2f, tby + (tbh - d.lineHeight(8.5f, Font.BOLD)) / 2f, 8.5f, Theme.accentLight(), Font.BOLD);
            if (ui.button("size.plus", "+", null, tbx + tbw - 26, tby + 2, 24, tbh - 4, Ui.Style.GHOST, selected.scale.value() < selected.scale.max - 0.001f)) resizeSelected(0.05f);
        }

        // centre panel (hidden while dragging so it never covers the spot you aim for)
        float show = ui.anim("panel", dragging == null && !resizing ? 1f : 0f, 14f);
        if (show > 0.05f) {
            d.shadow(px, py, pw, ph, 16, Draw.alpha(0xFF000000, 0.5f * show));
            d.panel(px, py, pw, ph, 12, Draw.alpha(Theme.PANEL_SOLID, 0.94f * show), Draw.alpha(Theme.LINE_STRONG, show));
            d.image("logo", 256, 256, px + 14, py + 12, 24, 24, Draw.alpha(0xFFFFFFFF, show));
            d.text(Hammer.t("editor.title"), px + 46, py + 12, 12, Draw.alpha(Theme.TEXT, show), Font.BOLD);
            d.text(Hammer.t("editor.hint"), px + 46, py + 28, 7.5f, Draw.alpha(Theme.MUTED, show), Font.MEDIUM);
            List<String> more = d.wrap(Hammer.t("editor.hint2"), pw - 28, 7.5f, Font.MEDIUM, 2);
            for (int i = 0; i < more.size(); i++) d.text(more.get(i), px + 14, py + 45 + i * 10.5f, 7.5f, Draw.alpha(Theme.DIM, show), Font.MEDIUM);
            // size of the whole HUD
            float sy = py + 72;
            pl.hammershop.client.core.Config cfg = Hammer.config();
            // one slider: the size of the selected module, or of the whole HUD when none is selected
            d.rrect(px + 12, sy, pw - 24, 22, 7, Draw.alpha(0xFFFFFFFF, 0.04f * show));
            boolean one = selected != null;
            String what = one ? Hammer.t("editor.size_of", selected.name()) : Hammer.t("settings.hud_scale");
            float value = one ? selected.scale.value() : cfg.hudScaleInUse();
            d.textIn(d.ellipsis(what, pw - 24 - 160, 8, Font.MEDIUM), px + 21, sy, 22, 8, Draw.alpha(Theme.TEXT, show), Font.MEDIUM);
            d.textRight(Math.round(value * 100) + "%", px + pw - 21, sy + (22 - d.lineHeight(8, Font.BOLD)) / 2f, 8, Draw.alpha(Theme.accentLight(), show), Font.BOLD);
            if (dragging == null && !resizing) {
                if (one) setScale(selected, ui.slider("onescale", value, selected.scale.min, selected.scale.max, 0.05f, px + pw - 21 - 34 - 100, sy + 4, 100));
                else cfg.setHudScale(ui.slider("hudscale", value, pl.hammershop.client.core.Config.HUD_SCALE_MIN, pl.hammershop.client.core.Config.HUD_SCALE_MAX, 0.05f, px + pw - 21 - 34 - 100, sy + 4, 100));
            }
            if (dragging == null) {
                float bw = (pw - 28 - 16) / 3f;
                float by = py + ph - 34;
                if (ui.button("mods", Hammer.t("editor.mods"), "puzzle", px + 14, by, bw, 24, Ui.Style.SECONDARY)) {
                    if (parent instanceof ModMenuScreen) Hammer.back(this);
                    else {
                        ModMenuScreen menu = new ModMenuScreen();
                        menu.parent = this;
                        Hammer.open(menu);
                    }
                    return;
                }
                if (ui.button("reset", Hammer.t("editor.reset"), "reset", px + 14 + bw + 8, by, bw, 24, Ui.Style.SECONDARY)) {
                    for (HudModule m : Modules.HUD) {
                        m.resetPosition();
                        m.scale.reset();
                    }
                    Hammer.config().setHudScale(1f);
                }
                if (ui.button("done", Hammer.t("menu.done"), "check", px + 14 + (bw + 8) * 2, by, bw, 24, Ui.Style.PRIMARY)) Hammer.back(this);
            }
        }
    }

    /** Moves the dragged module to (x, y) GUI pixels, snapping to edges, the centre and other modules. */
    private void drag(HudModule m, float x, float y, float sw, float sh) {
        guides.clear();
        float w = m.scaledW();
        float h = m.scaledH();
        float bestX = SNAP;
        float bestY = SNAP;
        float snapX = x;
        float snapY = y;
        float guideX = Float.NaN;
        float guideY = Float.NaN;
        // screen: edges and centre
        float[][] xs = {{0, Float.NaN}, {sw - w, Float.NaN}, {(sw - w) / 2f, sw / 2f}};
        float[][] ys = {{0, Float.NaN}, {sh - h, Float.NaN}, {(sh - h) / 2f, sh / 2f}};
        List<float[]> cx = new ArrayList<>(List.of(xs));
        List<float[]> cy = new ArrayList<>(List.of(ys));
        for (HudModule o : Modules.HUD) {
            if (o == m || !o.enabled() || o.w <= 0) continue;
            float ox = o.left(sw);
            float oy = o.top(sh);
            float ow = o.scaledW();
            float oh = o.scaledH();
            cx.add(new float[] {ox, ox});                 // left edges aligned
            cx.add(new float[] {ox + ow - w, ox + ow});   // right edges aligned
            cx.add(new float[] {ox + ow + 2, ox + ow + 1}); // next to it, on the right
            cx.add(new float[] {ox - w - 2, ox - 1});     // next to it, on the left
            cy.add(new float[] {oy, oy});
            cy.add(new float[] {oy + oh - h, oy + oh});
            cy.add(new float[] {oy + oh + 2, oy + oh + 1});
            cy.add(new float[] {oy - h - 2, oy - 1});
        }
        for (float[] c : cx) {
            float dist = Math.abs(x - c[0]);
            if (dist < bestX) {
                bestX = dist;
                snapX = c[0];
                guideX = c[1];
            }
        }
        for (float[] c : cy) {
            float dist = Math.abs(y - c[0]);
            if (dist < bestY) {
                bestY = dist;
                snapY = c[0];
                guideY = c[1];
            }
        }
        if (!Float.isNaN(guideX)) guides.add(new float[] {1, guideX});
        if (!Float.isNaN(guideY)) guides.add(new float[] {0, guideY});
        m.moveTo(Math.max(0, Math.min(sw - w, snapX)), Math.max(0, Math.min(sh - h, snapY)), sw, sh);
    }
}
