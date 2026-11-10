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
 * HUD editor: drag the modules where you want them. They snap to the screen edges, the centre and to each other;
 * the mouse wheel resizes the module under the cursor and a right click opens its settings. Positions are kept as
 * shares of the screen, so the layout fits any window size.
 */
public class HudEditorScreen extends UiScreen {
    private static final float SNAP = 4f;

    private HudModule dragging;
    private float grabX;
    private float grabY;
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
        float ph = 96;
        float px = (ui.w - pw) / 2f;
        float py = Math.max(60, ui.h * 0.3f - ph / 2f);
        boolean overPanel = dragging == null && ui.hover(px, py, pw, ph);

        d.push();
        d.scale(1f / s);
        // faint centre lines
        d.fill(sw / 2f - 0.5f, 0, 1, sh, 0x18FFFFFF);
        d.fill(0, sh / 2f - 0.5f, sw, 1, 0x18FFFFFF);
        Hammer.drawHud(d, true);

        HudModule hover = null;
        if (!overPanel) {
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
            dragging = hover;
            grabX = mx - hover.left(sw);
            grabY = my - hover.top(sh);
            ui.pressed = false;
        }
        if (!ui.down && dragging != null) {
            dragging = null;
            guides.clear();
            Hammer.config().markDirty();
        }
        if (dragging != null) drag(dragging, mx - grabX, my - grabY, sw, sh);
        if (ui.scroll != 0 && hover != null) {
            float v = hover.scale.value() + (ui.scroll > 0 ? 0.05f : -0.05f);
            hover.scale.set(Math.max(hover.scale.min, Math.min(hover.scale.max, v)));
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
            boolean hot = m == hover || m == dragging;
            int c = hot ? Theme.accentLight() : Draw.alpha(Theme.accent(), 0.55f);
            d.fill(x - 1, y - 1, w + 2, 1, c);
            d.fill(x - 1, y + h, w + 2, 1, c);
            d.fill(x - 1, y, 1, h, c);
            d.fill(x + w, y, 1, h, c);
            if (hot) {
                String label = m.name() + (Math.abs(m.scale.value() - 1f) > 0.01f ? "  " + m.scale.text() : "");
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

        // centre panel (hidden while dragging so it never covers the spot you aim for)
        float show = ui.anim("panel", dragging == null ? 1f : 0f, 14f);
        if (show > 0.05f) {
            d.shadow(px, py, pw, ph, 16, Draw.alpha(0xFF000000, 0.5f * show));
            d.panel(px, py, pw, ph, 12, Draw.alpha(Theme.PANEL_SOLID, 0.94f * show), Draw.alpha(Theme.LINE_STRONG, show));
            d.image("logo", 256, 256, px + 14, py + 12, 24, 24, Draw.alpha(0xFFFFFFFF, show));
            d.text(Hammer.t("editor.title"), px + 46, py + 12, 12, Draw.alpha(Theme.TEXT, show), Font.BOLD);
            d.text(Hammer.t("editor.hint"), px + 46, py + 28, 7.5f, Draw.alpha(Theme.MUTED, show), Font.MEDIUM);
            d.text(Hammer.t("editor.hint2"), px + 14, py + 46, 7.5f, Draw.alpha(Theme.DIM, show), Font.MEDIUM);
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
