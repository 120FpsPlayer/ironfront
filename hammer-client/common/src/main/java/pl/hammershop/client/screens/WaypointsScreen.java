package pl.hammershop.client.screens;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Game;
import pl.hammershop.client.core.Waypoints;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;
import pl.hammershop.client.ui.UiScreen;

import java.util.ArrayList;
import java.util.List;

/** The waypoint list of the current world: add one where you stand, hide, delete, copy the coordinates. */
public class WaypointsScreen extends UiScreen {
    private static final int[] COLORS = {0xFFFF9F43, 0xFFFFC83D, 0xFFFF6B6B, 0xFFFF7EB6, 0xFFB18CFF, 0xFF5CA8FF, 0xFF4DD9E6, 0xFF5EE08D};

    private String name = "";
    private int color;
    private String message;
    private float messageAt;

    @Override
    public void render(Ui ui) {
        Draw d = ui.d;
        Game g = Hammer.game();
        float in = ui.enter(0f, 0.3f);
        Backdrop.dim(ui, 0.62f * in);

        float pw = Math.min(540, ui.w - 32);
        float ph = Math.min(420, ui.h - 28);
        float px = (ui.w - pw) / 2f;
        float py = (ui.h - ph) / 2f + (1 - in) * 14;
        d.shadow(px, py, pw, ph, 22, 0x99000000);
        d.panel(px, py, pw, ph, 14, Theme.PANEL, Theme.LINE_STRONG);

        String world = g.worldKey();
        String dim = g.dimension();
        List<Waypoints.Point> list = new ArrayList<>(Waypoints.of(world));

        // header
        float x = px + 18;
        float w = pw - 36;
        d.rrect(x, py + 16, 28, 28, 9, Draw.alpha(Theme.accent(), 0.16f));
        d.icon("pin", x + 7.5f, py + 23.5f, 13, Theme.accent());
        d.text(Hammer.t("waypoints.title"), x + 38, py + 15, 13.5f, Theme.TEXT, Font.BOLD);
        String where = world.startsWith("sp:") ? world.substring(3) : world;
        d.text(d.ellipsis(Hammer.t("waypoints.sub", where, Waypoints.dimensionName(dim), list.size(), Waypoints.LIMIT), w - 80, 8, Font.MEDIUM), x + 38, py + 32, 8, Theme.DIM, Font.MEDIUM);
        if (ui.iconButton("close", "close", px + pw - 40, py + 17, 24, Hammer.t("menu.back"))) {
            Hammer.back(this);
            return;
        }

        // add row
        float ay = py + 58;
        float addW = 122;
        float dotsW = COLORS.length * 17;
        name = ui.textField("wp.name", name, Hammer.t("waypoints.name"), "pen", x, ay, w - addW - dotsW - 22, 28);
        float cx = x + w - addW - dotsW - 10;
        for (int i = 0; i < COLORS.length; i++) {
            float dx = cx + i * 17 + 7;
            float dy = ay + 14;
            boolean sel = i == color;
            boolean hot = ui.hover(dx - 8, dy - 8, 16, 16);
            float a = ui.hoverAnim("wp.c" + i, hot || sel);
            if (sel) d.circle(dx, dy, 7.5f, 0xFFFFFFFF);
            d.circle(dx, dy, 5 + a, COLORS[i]);
            if (ui.click(dx - 8, dy - 8, 16, 16)) {
                Hammer.platform().clickSound();
                color = i;
            }
        }
        boolean room = list.size() < Waypoints.LIMIT && !world.isEmpty();
        if (ui.button("wp.add", Hammer.t("waypoints.add"), "plus", x + w - addW, ay, addW, 28, Ui.Style.PRIMARY, room)) {
            String n = name.trim().isEmpty() ? Hammer.t("waypoints.default_name", list.size() + 1) : name.trim();
            if (Waypoints.add(world, Waypoints.here(g, n, COLORS[color]))) {
                name = "";
                ui.st.focusOrPopupClosed();
                say(ui, Hammer.t("waypoints.added", n));
                list = new ArrayList<>(Waypoints.of(world));
            }
        }

        // list
        float top = ay + 40;
        float height = ph - (top - py) - 34;
        float rowH = 30;
        if (list.isEmpty()) {
            d.icon("pin", x + w / 2f - 12, top + height / 2f - 34, 24, Theme.DIM);
            d.textCentered(Hammer.t("waypoints.empty"), x + w / 2f, top + height / 2f, 10, Theme.MUTED, Font.BOLD);
            d.textCentered(Hammer.t("waypoints.empty.sub"), x + w / 2f, top + height / 2f + 15, 8, Theme.DIM, Font.MEDIUM);
        } else {
            ui.beginScroll("wp.list", x - 4, top, w + 8, height, list.size() * rowH + 4);
            float y = top + 2;
            for (Waypoints.Point p : list) {
                row(ui, world, p, dim, g, x, y, w, rowH - 4);
                y += rowH;
            }
            ui.endScroll();
        }

        // footer
        float fy = py + ph - 24;
        d.fill(x, fy - 6, w, 1, Theme.LINE);
        boolean showMessage = message != null && ui.time - messageAt < 3f;
        d.text(showMessage ? message : Hammer.t("waypoints.hint"), x, fy, 7.5f, showMessage ? Theme.OK : Theme.DIM, Font.MEDIUM);
    }

    private void say(Ui ui, String text) {
        message = text;
        messageAt = ui.time;
    }

    private void row(Ui ui, String world, Waypoints.Point p, String dim, Game g, float x, float y, float w, float h) {
        Draw d = ui.d;
        boolean here = p.dim.equals(dim);
        boolean hot = ui.hover(x, y, w, h);
        float fade = p.visible ? 1f : 0.45f;
        d.rrect(x, y, w, h, 8, Draw.alpha(0xFFFFFFFF, hot ? 0.05f : 0.025f));
        d.circle(x + 14, y + h / 2f, 5, Draw.alpha(p.color | 0xFF000000, fade));
        if (p.death) d.icon("skull", x + 10.5f, y + h / 2f - 3.5f, 7, Draw.alpha(Theme.INK, fade));
        float tx = x + 28;
        float nameW = Math.max(60, w - 300);
        d.textIn(d.ellipsis(p.name.isEmpty() ? "—" : p.name, nameW, 9, Font.BOLD), tx, y, h, 9, Draw.alpha(Theme.TEXT, fade), Font.BOLD);
        String coords = p.x + ", " + p.y + ", " + p.z;
        d.textIn(coords, tx + nameW + 8, y, h, 8, Draw.alpha(Theme.MUTED, fade), Font.MEDIUM);
        float right = x + w - 8;
        // delete · copy · show/hide
        String id = "wp." + System.identityHashCode(p);
        if (ui.iconButton(id + ".del", "trash", right - 20, y + 3, 20, Hammer.t("waypoints.delete"))) {
            Waypoints.remove(world, p);
            say(ui, Hammer.t("waypoints.deleted", p.name));
            return;
        }
        if (ui.iconButton(id + ".copy", "copy", right - 44, y + 3, 20, Hammer.t("waypoints.copy"))) {
            Hammer.platform().setClipboard(p.x + " " + p.y + " " + p.z);
            say(ui, Hammer.t("waypoints.copied", coords));
        }
        if (ui.iconButton(id + ".eye", p.visible ? "freelook" : "hidden", right - 68, y + 3, 20, Hammer.t(p.visible ? "waypoints.hide" : "waypoints.show"))) {
            p.visible = !p.visible;
            Waypoints.changed();
        }
        String tag = here ? Waypoints.distanceText(Waypoints.distance(g, p)) : Waypoints.dimensionName(p.dim);
        float tw = d.textWidth(tag, 7.5f, Font.BOLD) + 12;
        float tagX = right - 76 - tw;
        d.rrect(tagX, y + (h - 14) / 2f, tw, 14, 7, here ? Draw.alpha(Theme.accent(), 0.16f) : 0x1FFFFFFF);
        d.textIn(tag, tagX + 6, y + (h - 14) / 2f, 14, 7.5f, here ? Theme.accentLight() : Theme.MUTED, Font.BOLD);
    }
}
