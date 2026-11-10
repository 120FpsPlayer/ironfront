package pl.hammershop.client.screens;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.core.Config;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Modules;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;
import pl.hammershop.client.ui.UiScreen;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The module panel (right Shift): categories on the left, a searchable grid of module cards with switches, a
 * settings page per module, and the client's own settings (accent colour, profiles, menus, keys).
 */
public class ModMenuScreen extends UiScreen {
    private static final String[] TABS = {"all", "hud", "gameplay", "visual", "settings"};
    private static final String[] TAB_ICONS = {"grid", "hud", "gamepad", "palette", "gear"};

    private String tab = "all";
    private String search = "";
    private Module editing;

    public ModMenuScreen() {
    }

    /** Opens straight on one module's settings (right click in the HUD editor). */
    public ModMenuScreen(Module module) {
        this.editing = module;
        this.tab = module.category.id;
    }

    @Override
    public boolean escape() {
        if (editing != null) {
            editing = null;
            return false;
        }
        return true;
    }

    @Override
    public void render(Ui ui) {
        Draw d = ui.d;
        boolean inWorld = Hammer.game().inWorld();
        float in = ui.enter(0f, 0.3f);
        if (inWorld) Backdrop.dim(ui, 0.62f * in);
        else Backdrop.menu(ui, false);

        float pw = Math.min(790, ui.w - 32);
        float ph = Math.min(460, ui.h - 28);
        float px = (ui.w - pw) / 2f;
        float py = (ui.h - ph) / 2f + (1 - in) * 14;
        float side = 170;

        d.shadow(px, py, pw, ph, 22, 0x99000000);
        d.panel(px, py, pw, ph, 14, Theme.PANEL, Theme.LINE_STRONG);
        // sidebar plate
        d.rrect(px + 1, py + 1, side, ph - 2, 13, 0xFF120D08);
        d.fill(px + side - 12, py + 1, 13, ph - 2, 0xFF120D08);
        d.fill(px + side, py + 1, 1, ph - 2, Theme.LINE);

        sidebar(ui, px, py, side, ph);

        float cx = px + side + 16;
        float cw = pw - side - 32;
        if ("settings".equals(tab)) clientSettings(ui, cx, py, cw, ph);
        else if (editing != null) moduleSettings(ui, cx, py, cw, ph);
        else grid(ui, cx, py, cw, ph);
    }

    // ───────────── sidebar ─────────────

    private void sidebar(Ui ui, float px, float py, float side, float ph) {
        Draw d = ui.d;
        Config cfg = Hammer.config();
        d.image("logo", 256, 256, px + 14, py + 14, 28, 28, 0xFFFFFFFF);
        d.text("Hammer Client", px + 48, py + 15, 10.5f, Theme.TEXT, Font.BOLD);
        d.text("v" + Hammer.version() + "  ·  MC " + Hammer.platform().minecraftVersion(), px + 48, py + 29, 7f, Theme.DIM, Font.MEDIUM);

        float y = py + 58;
        for (int i = 0; i < TABS.length; i++) {
            if (i == TABS.length - 1) {
                d.fill(px + 14, y + 4, side - 28, 1, Theme.LINE);
                y += 10;
            }
            String id = TABS[i];
            boolean sel = id.equals(tab);
            boolean hot = ui.hover(px + 8, y, side - 16, 26);
            float a = ui.hoverAnim("tab." + id, hot || sel);
            if (sel) {
                d.rrect(px + 8, y, side - 16, 26, 8, Draw.alpha(Theme.accent(), 0.16f));
                d.rrect(px + 8, y + 6, 2.5f, 14, 1.2f, Theme.accent());
            } else d.rrect(px + 8, y, side - 16, 26, 8, Draw.alpha(0xFFFFFFFF, 0.05f * a));
            d.icon(TAB_ICONS[i], px + 20, y + 7.5f, 11, sel ? Theme.accent() : Draw.mix(Theme.MUTED, Theme.TEXT, a));
            d.textIn(tabLabel(id), px + 40, y, 26, 9, sel ? Theme.TEXT : Draw.mix(Theme.MUTED, Theme.TEXT, a), sel ? Font.BOLD : Font.MEDIUM);
            if (!"settings".equals(id)) {
                String n = String.valueOf(count(id));
                d.textRight(n, px + side - 18, y + 8.5f, 7.5f, sel ? Theme.accentLight() : Theme.DIM, Font.BOLD);
            }
            if (ui.click(px + 8, y, side - 16, 26)) {
                Hammer.platform().clickSound();
                tab = id;
                editing = null;
            }
            y += 29;
        }

        // bottom: profile + HUD editor
        float by = py + ph - 96;
        d.text(Hammer.t("menu.profile"), px + 14, by, 7.5f, Theme.DIM, Font.BOLD);
        List<String> keys = new ArrayList<>(cfg.profiles.keySet());
        String[] names = new String[keys.size()];
        for (int i = 0; i < names.length; i++) names[i] = cfg.profiles.get(keys.get(i)).name;
        int cur = Math.max(0, keys.indexOf(cfg.profile));
        int chosen = ui.choice("profile", names, cur, px + 12, by + 13, side - 24, 24);
        if (chosen != cur) switchProfile(keys.get(chosen));
        if (ui.button("edit_hud", Hammer.t("menu.edit_hud"), "move", px + 12, py + ph - 44, side - 24, 30, Ui.Style.PRIMARY)) {
            HudEditorScreen s = new HudEditorScreen();
            s.parent = this;
            Hammer.open(s);
        }
    }

    private static void switchProfile(String key) {
        Config cfg = Hammer.config();
        for (Module m : Modules.ALL) if (m.enabled()) m.onDisable();
        cfg.profile = key;
        cfg.markDirty();
        Modules.apply(true);
    }

    private static String tabLabel(String id) {
        return switch (id) {
            case "all" -> Hammer.t("menu.all");
            case "settings" -> Hammer.t("menu.settings");
            default -> Hammer.t("category." + id);
        };
    }

    private static int count(String tab) {
        int n = 0;
        for (Module m : Modules.ALL) if (tab.equals("all") || m.category.id.equals(tab)) n++;
        return n;
    }

    // ───────────── module grid ─────────────

    private List<Module> visible() {
        String q = search.trim().toLowerCase(Locale.ROOT);
        List<Module> list = new ArrayList<>();
        for (Module m : Modules.ALL) {
            if (!tab.equals("all") && !m.category.id.equals(tab)) continue;
            if (!q.isEmpty() && !m.name().toLowerCase(Locale.ROOT).contains(q) && !m.description().toLowerCase(Locale.ROOT).contains(q)) continue;
            list.add(m);
        }
        return list;
    }

    private void grid(Ui ui, float x, float py, float w, float ph) {
        Draw d = ui.d;
        List<Module> list = visible();
        int on = 0;
        for (Module m : list) if (m.enabled()) on++;
        d.text(tabLabel(tab), x, py + 16, 15, Theme.TEXT, Font.BOLD);
        d.text(Hammer.t("menu.enabled_count", on, list.size()), x, py + 35, 8, Theme.DIM, Font.MEDIUM);
        float fieldW = Math.min(190, w * 0.36f);
        String before = search;
        search = ui.textField("search", search, Hammer.t("menu.search"), "search", x + w - fieldW, py + 16, fieldW, 26);
        if (!before.equals(search)) ui.resetScroll("grid");

        float top = py + 56;
        float height = ph - 56 - 14;
        int cols = w >= 540 ? 3 : w >= 350 ? 2 : 1;
        float gap = 10;
        float cardW = (w - gap * (cols - 1)) / cols;
        float cardH = 78;
        int rows = (list.size() + cols - 1) / cols;
        if (list.isEmpty()) {
            d.icon("search", x + w / 2f - 12, top + height / 2f - 34, 24, Theme.DIM);
            d.textCentered(Hammer.t("menu.nothing"), x + w / 2f, top + height / 2f, 10, Theme.MUTED, Font.BOLD);
            return;
        }
        ui.beginScroll("grid", x - 4, top, w + 8, height, rows * (cardH + gap) - gap + 6);
        for (int i = 0; i < list.size(); i++) {
            float cx = x + (i % cols) * (cardW + gap);
            float cy = top + 2 + (i / cols) * (cardH + gap);
            card(ui, list.get(i), cx, cy, cardW, cardH);
        }
        ui.endScroll();
    }

    private void card(Ui ui, Module m, float x, float y, float w, float h) {
        Draw d = ui.d;
        boolean on = m.enabled();
        boolean hot = ui.hover(x, y, w, h);
        float a = ui.hoverAnim("card." + m.id, hot);
        float e = ui.anim("cardon." + m.id, on ? 1f : 0f, 14f);
        d.panel(x, y, w, h, 10, Draw.mix(Theme.CARD, Theme.CARD_HOVER, a), Draw.mix(Draw.mix(Theme.LINE, Theme.LINE_STRONG, a), Theme.accent(), e * 0.75f));
        // icon tile
        d.rrect(x + 10, y + 10, 26, 26, 8, Draw.mix(Draw.alpha(Theme.accent(), 0.13f), Theme.accent(), e));
        d.icon(m.icon, x + 16.5f, y + 16.5f, 13, Draw.mix(Theme.accent(), Theme.INK, e));
        d.text(d.ellipsis(m.name(), w - 90, 9.5f, Font.BOLD), x + 44, y + 11, 9.5f, Theme.TEXT, Font.BOLD);
        d.text(on ? Hammer.t("on") : Hammer.t("off"), x + 44, y + 24, 7, Draw.mix(Theme.DIM, Theme.OK, e), Font.BOLD);
        List<String> lines = d.wrap(m.description(), w - 46, 7.5f, Font.MEDIUM, 2);
        for (int i = 0; i < lines.size(); i++) d.text(lines.get(i), x + 11, y + 44 + i * 10.5f, 7.5f, Theme.DIM, Font.MEDIUM);

        boolean now = ui.toggle("toggle." + m.id, on, x + w - Ui.TOGGLE_W - 10, y + 13);
        if (now != on) m.setEnabled(now);
        if (ui.iconButton("gear." + m.id, "gear", x + w - 27, y + h - 27, 19, Hammer.t("menu.options"))) {
            editing = m;
            ui.resetScroll("settings");
        }
    }

    // ───────────── one module's settings ─────────────

    private void moduleSettings(Ui ui, float x, float py, float w, float ph) {
        Draw d = ui.d;
        Module m = editing;
        if (ui.iconButton("back", "back", x, py + 15, 26, Hammer.t("menu.back"))) {
            editing = null;
            return;
        }
        boolean on = m.enabled();
        d.rrect(x + 36, py + 15, 26, 26, 8, on ? Theme.accent() : Draw.alpha(Theme.accent(), 0.13f));
        d.icon(m.icon, x + 42.5f, py + 21.5f, 13, on ? Theme.INK : Theme.accent());
        d.text(m.name(), x + 70, py + 15, 13, Theme.TEXT, Font.BOLD);
        d.text(d.ellipsis(m.description(), w - 130, 8, Font.MEDIUM), x + 70, py + 31, 8, Theme.DIM, Font.MEDIUM);
        boolean now = ui.toggle("toggle." + m.id, on, x + w - Ui.TOGGLE_W, py + 20);
        if (now != on) m.setEnabled(now);

        float top = py + 56;
        float height = ph - 56 - 52;
        String note = m.note();
        float rowH = 32;
        float content = m.settings.size() * rowH + (note != null ? 34 : 0) + 6;
        ui.beginScroll("settings", x - 4, top, w + 8, height, content);
        float y = top + 2;
        if (note != null) {
            d.panel(x, y, w, 26, 8, Draw.alpha(Theme.accent(), 0.08f), Draw.alpha(Theme.accent(), 0.3f));
            d.icon("info", x + 9, y + 8, 10, Theme.accentLight());
            d.textIn(d.ellipsis(note, w - 34, 8, Font.MEDIUM), x + 25, y, 26, 8, Theme.accentLight(), Font.MEDIUM);
            y += 34;
        }
        for (Setting<?> s : m.settings) {
            settingRow(ui, s, x, y, w, rowH - 4);
            y += rowH;
        }
        if (m.settings.isEmpty() && note == null) d.text(Hammer.t("menu.no_options"), x, y + 6, 8.5f, Theme.DIM, Font.MEDIUM);
        ui.endScroll();

        float by = py + ph - 42;
        d.fill(x, by - 8, w, 1, Theme.LINE);
        if (ui.button("reset", Hammer.t("menu.reset"), "reset", x, by, 150, 28, Ui.Style.SECONDARY)) {
            m.resetSettings();
            if (m instanceof HudModule hm) hm.resetPosition();
            ui.st.closePopup();
        }
        if (m instanceof HudModule && ui.button("place", Hammer.t("menu.place"), "move", x + w - 170, by, 170, 28, Ui.Style.PRIMARY)) {
            HudEditorScreen s = new HudEditorScreen();
            s.parent = this;
            Hammer.open(s);
        }
    }

    private void settingRow(Ui ui, Setting<?> s, float x, float y, float w, float h) {
        Draw d = ui.d;
        boolean hot = ui.hover(x, y, w, h);
        d.rrect(x, y, w, h, 8, Draw.alpha(0xFFFFFFFF, hot ? 0.045f : 0.022f));
        d.textIn(s.label(), x + 12, y, h, 8.5f, Theme.TEXT, Font.MEDIUM);
        String id = "set." + s.module.id + "." + s.id;
        float right = x + w - 12;
        if (s instanceof Setting.Bool b) {
            boolean v = ui.toggle(id, b.on(), right - Ui.TOGGLE_W, y + (h - Ui.TOGGLE_H) / 2f);
            if (v != b.on()) b.set(v);
        } else if (s instanceof Setting.Slider sl) {
            d.textRight(sl.text(), right, y + (h - d.lineHeight(8.5f, Font.BOLD)) / 2f, 8.5f, Theme.accentLight(), Font.BOLD);
            float v = ui.slider(id, sl.value(), sl.min, sl.max, sl.step, right - 46 - 150, y + (h - 14) / 2f, 150);
            if (Math.abs(v - sl.value()) > 0.0001f) sl.set(v);
        } else if (s instanceof Setting.Choice c) {
            int v = ui.choice(id, c.labels(), c.get(), right - 160, y + 3, 160, h - 6);
            if (v != c.get()) c.set(v);
        } else if (s instanceof Setting.Color c) {
            int[] v = ui.color(id, c.get(), c.chroma(), c.allowChroma, right - 30, y + (h - 16) / 2f);
            if (v[0] != c.get()) c.set(v[0]);
            if ((v[1] != 0) != c.chroma()) c.setChroma(v[1] != 0);
        }
    }

    // ───────────── the client's own settings ─────────────

    private void clientSettings(Ui ui, float x, float py, float w, float ph) {
        Draw d = ui.d;
        Config cfg = Hammer.config();
        Platform p = Hammer.platform();
        d.text(Hammer.t("menu.settings"), x, py + 16, 15, Theme.TEXT, Font.BOLD);
        d.text(Hammer.t("menu.settings.sub"), x, py + 35, 8, Theme.DIM, Font.MEDIUM);
        float top = py + 56;
        float height = ph - 56 - 14;
        float rowH = 32;
        ui.beginScroll("client", x - 4, top, w + 8, height, 13 * rowH + 86);
        float y = top + 2;

        y = section(d, Hammer.t("settings.look"), x, y);
        // accent colour
        row(ui, Hammer.t("settings.accent"), x, y, w, rowH - 4);
        float sx = x + w - 12 - Theme.ACCENT_IDS.length * 22 + 4;
        for (int i = 0; i < Theme.ACCENT_IDS.length; i++) {
            String id = Theme.ACCENT_IDS[i];
            float cx = sx + i * 22 + 9;
            float cy = y + (rowH - 4) / 2f;
            boolean sel = id.equals(cfg.accent);
            boolean hot = ui.hover(cx - 10, cy - 10, 20, 20);
            float a = ui.hoverAnim("accent." + id, hot || sel);
            if (sel) d.circle(cx, cy, 10, 0xFFFFFFFF);
            d.circle(cx, cy, 7 + 1.2f * a, Theme.accentOf(id));
            if (ui.click(cx - 10, cy - 10, 20, 20)) {
                p.clickSound();
                cfg.accent = id;
                cfg.markDirty();
            }
        }
        y += rowH;
        y = toggleRow(ui, "anim", Hammer.t("settings.animations"), cfg.animations, x, y, w, rowH, v -> cfg.animations = v);
        y = toggleRow(ui, "menu", Hammer.t("settings.custom_menu"), cfg.customMenu, x, y, w, rowH, v -> cfg.customMenu = v);
        y = toggleRow(ui, "pause", Hammer.t("settings.pause_buttons"), cfg.pauseButtons, x, y, w, rowH, v -> cfg.pauseButtons = v);

        y = section(d, "HUD", x, y + 6);
        y = toggleRow(ui, "hud", Hammer.t("settings.hud_visible"), cfg.hudVisible, x, y, w, rowH, v -> cfg.hudVisible = v);
        row(ui, Hammer.t("settings.hud_font"), x, y, w, rowH - 4);
        int font = "hammer".equals(cfg.hudFont) ? 1 : 0;
        int nf = ui.choice("hudfont", new String[] {Hammer.t("option.font_minecraft"), Hammer.t("option.font_hammer")}, font, x + w - 172, y + 3, 160, rowH - 10);
        if (nf != font) {
            cfg.hudFont = nf == 1 ? "hammer" : "minecraft";
            cfg.markDirty();
        }
        y += rowH;

        y = section(d, Hammer.t("settings.profiles"), x, y + 6);
        row(ui, Hammer.t("settings.profile_current", cfg.active().name), x, y, w, rowH - 4);
        if (ui.button("p.new", Hammer.t("settings.profile_new"), "plus", x + w - 12 - 208, y + 3, 100, rowH - 10, Ui.Style.SECONDARY)) {
            String key = cfg.addProfile(Hammer.t("settings.profile_name", cfg.profiles.size() + 1), true);
            switchProfile(key);
        }
        if (ui.button("p.del", Hammer.t("settings.profile_delete"), "trash", x + w - 12 - 100, y + 3, 100, rowH - 10, Ui.Style.DANGER, cfg.profiles.size() > 1)) {
            String old = cfg.profile;
            for (Module m : Modules.ALL) if (m.enabled()) m.onDisable();
            cfg.removeProfile(old);
            Modules.apply(true);
        }
        y += rowH;

        y = section(d, Hammer.t("settings.keys"), x, y + 6);
        for (Keys k : Keys.values()) {
            if (k == Keys.FREELOOK && Modules.freelook == null) continue;
            if (k == Keys.ZOOM && Modules.zoom == null) continue;
            row(ui, Hammer.t("key." + k.id), x, y, w, rowH - 4);
            String name = p.keyName(k.id);
            float kw = Math.max(34, d.textWidth(name, 8, Font.BOLD) + 16);
            d.panel(x + w - 12 - kw, y + 5, kw, rowH - 14, 6, 0xFF2A2017, Theme.LINE_STRONG);
            d.textCentered(name, x + w - 12 - kw / 2f, y + 5 + (rowH - 14 - d.lineHeight(8, Font.BOLD)) / 2f, 8, Theme.TEXT, Font.BOLD);
            y += rowH;
        }
        if (ui.button("controls", Hammer.t("settings.change_keys"), "keystrokes", x, y + 2, 200, 26, Ui.Style.SECONDARY)) p.showVanilla(Platform.Vanilla.CONTROLS, this);
        if (!cfg.discordUrl.isEmpty() && ui.button("s.discord", Hammer.t("pause.discord"), "discord", x + w - 150, y + 2, 150, 26, Ui.Style.DISCORD)) p.openUrl(cfg.discordUrl);
        ui.endScroll();
    }

    private static float section(Draw d, String title, float x, float y) {
        d.text(title.toUpperCase(Locale.ROOT), x + 2, y + 4, 7.5f, Theme.accentLight(), Font.BOLD);
        return y + 20;
    }

    private static void row(Ui ui, String label, float x, float y, float w, float h) {
        boolean hot = ui.hover(x, y, w, h);
        ui.d.rrect(x, y, w, h, 8, Draw.alpha(0xFFFFFFFF, hot ? 0.045f : 0.022f));
        ui.d.textIn(label, x + 12, y, h, 8.5f, Theme.TEXT, Font.MEDIUM);
    }

    private interface BoolSetter {
        void set(boolean v);
    }

    private static float toggleRow(Ui ui, String id, String label, boolean value, float x, float y, float w, float rowH, BoolSetter setter) {
        row(ui, label, x, y, w, rowH - 4);
        boolean v = ui.toggle("cs." + id, value, x + w - 12 - Ui.TOGGLE_W, y + (rowH - 4 - Ui.TOGGLE_H) / 2f);
        if (v != value) {
            setter.set(v);
            Hammer.config().markDirty();
        }
        return y + rowH;
    }
}
