package pl.hammershop.client.screens;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.core.Config;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;
import pl.hammershop.client.ui.UiScreen;

/** The Hammer main menu that replaces the vanilla title screen. */
public class MainMenuScreen extends UiScreen {
    private static final int TIPS = 6;
    private static final int NEWS = 5;

    @Override
    public boolean escape() {
        return false; // nothing to go back to
    }

    @Override
    public void render(Ui ui) {
        Draw d = ui.d;
        Config cfg = Hammer.config();
        Platform p = Hammer.platform();
        Backdrop.menu(ui, true);

        float in = ui.enter(0f, 0.55f);
        float left = Math.max(36, ui.w * 0.075f) - (1 - in) * 24;
        float menuW = 232;
        float itemH = 36;
        float gap = 8;
        float blockH = 78 + 4 * (itemH + gap) + 30;
        float top = Math.max(18, (ui.h - blockH) / 2f - 6);
        int fade = Math.round(in * 255);

        // Logo and name.
        d.glow(left + 30, top + 30, 62, Draw.alpha(Theme.accent(), 0.22f * in));
        d.image("logo", 256, 256, left, top, 60, 60, (fade << 24) | 0xFFFFFF);
        d.text("HAMMER", left + 72, top + 6, 30, Draw.alpha(Theme.TEXT, in), Font.BOLD);
        d.text("CLIENT", left + 73, top + 37, 15, Draw.alpha(Theme.accent(), in), Font.BOLD);
        float cw = d.textWidth("CLIENT", 15, Font.BOLD);
        d.text(Hammer.t("title.by", cfg.brand), left + 73 + cw + 8, top + 41.5f, 8.5f, Draw.alpha(Theme.MUTED, in), Font.MEDIUM);

        float y = top + 78;
        if (item(ui, "single", "user", Hammer.t("title.singleplayer"), Hammer.t("title.singleplayer.sub"), left, y, menuW, itemH, true, 0.05f)) p.showVanilla(Platform.Vanilla.SINGLEPLAYER, this);
        y += itemH + gap;
        if (item(ui, "multi", "users", Hammer.t("title.multiplayer"), Hammer.t("title.multiplayer.sub"), left, y, menuW, itemH, false, 0.10f)) p.showVanilla(Platform.Vanilla.MULTIPLAYER, this);
        y += itemH + gap;
        if (item(ui, "mods", "puzzle", Hammer.t("title.mods"), Hammer.t("title.mods.sub", p.keyName(Keys.MENU.id)), left, y, menuW, itemH, false, 0.15f)) {
            ModMenuScreen s = new ModMenuScreen();
            s.parent = this;
            Hammer.open(s);
        }
        y += itemH + gap;
        if (item(ui, "options", "gear", Hammer.t("title.options"), Hammer.t("title.options.sub"), left, y, menuW, itemH, false, 0.20f)) p.showVanilla(Platform.Vanilla.OPTIONS, this);
        y += itemH + gap + 2;

        // Discord · shop · quit
        float third = (menuW - 12) / 3f;
        float a = ui.enter(0.25f, 0.5f);
        if (a > 0.02f) {
            boolean hasDiscord = !cfg.discordUrl.isEmpty();
            boolean hasShop = !cfg.shopUrl.isEmpty();
            if (ui.button("discord", "Discord", "discord", left, y, third, 24, Ui.Style.DISCORD, hasDiscord)) p.openUrl(cfg.discordUrl);
            if (ui.button("shop", Hammer.t("title.shop"), "store", left + third + 6, y, third, 24, Ui.Style.SECONDARY, hasShop)) p.openUrl(cfg.shopUrl);
            if (ui.button("quit", Hammer.t("title.quit"), "quit", left + (third + 6) * 2, y, third, 24, Ui.Style.DANGER)) p.quit();
        }

        // Right column: what's new + tip.
        float cardW = Math.min(300, ui.w - (left + menuW) - 70);
        if (cardW >= 200) {
            float cin = ui.enter(0.2f, 0.6f);
            float cx = ui.w - cardW - Math.max(30, ui.w * 0.05f) + (1 - cin) * 24;
            float cardH = 48 + NEWS * 22;
            float cy = Math.max(18, (ui.h - cardH - 64) / 2f);
            int ca = Math.round(cin * 255);
            if (ca > 4) {
                d.shadow(cx, cy, cardW, cardH, 14, Draw.alpha(0xFF000000, 0.45f * cin));
                d.panel(cx, cy, cardW, cardH, 12, Draw.alpha(0xFF140E08, 0.86f * cin), Draw.alpha(Theme.LINE_STRONG, cin));
                d.icon("magic", cx + 16, cy + 15, 12, Draw.alpha(Theme.accent(), cin));
                d.text(Hammer.t("news.title"), cx + 34, cy + 13, 11.5f, Draw.alpha(Theme.TEXT, cin), Font.BOLD);
                String tag = "v" + Hammer.version();
                float tw = d.textWidth(tag, 7.5f, Font.BOLD) + 12;
                d.rrect(cx + cardW - tw - 14, cy + 13, tw, 14, 7, Draw.alpha(Theme.accent(), 0.18f * cin));
                d.textIn(tag, cx + cardW - tw - 8, cy + 13, 14, 7.5f, Draw.alpha(Theme.accentLight(), cin), Font.BOLD);
                for (int i = 0; i < NEWS; i++) {
                    float ry = cy + 42 + i * 22;
                    d.circle(cx + 20, ry + 6, 2.2f, Draw.alpha(Theme.accent(), cin));
                    d.text(d.ellipsis(Hammer.t("news." + i), cardW - 46, 8.5f, Font.MEDIUM), cx + 30, ry, 8.5f, Draw.alpha(Theme.MUTED, cin), Font.MEDIUM);
                }
                // tip of the moment
                float ty = cy + cardH + 12;
                int tip = (int) ((System.currentTimeMillis() / 9000L) % TIPS);
                d.panel(cx, ty, cardW, 40, 10, Draw.alpha(0xFF140E08, 0.7f * cin), Draw.alpha(Theme.LINE, cin));
                d.icon("info", cx + 14, ty + 13.5f, 13, Draw.alpha(Theme.accentLight(), cin));
                java.util.List<String> lines = d.wrap(Hammer.t("tip." + tip), cardW - 50, 8f, Font.MEDIUM, 2);
                float ly = ty + (40 - lines.size() * 11) / 2f;
                for (String line : lines) {
                    d.text(line, cx + 36, ly, 8f, Draw.alpha(Theme.MUTED, cin), Font.MEDIUM);
                    ly += 11;
                }
            }
        }

        // Account (top right) and footer.
        String user = p.game().playerName();
        if (!user.isEmpty()) {
            float uw = d.textWidth(user, 8.5f, Font.BOLD) + 38;
            float ux = ui.w - uw - 16;
            d.panel(ux, 14, uw, 22, 11, 0xB3140E08, Theme.LINE);
            d.circle(ux + 12, 25, 6.5f, Theme.accent());
            d.textCentered(user.substring(0, 1).toUpperCase(), ux + 12, 19.7f, 8.5f, Theme.INK, Font.BOLD);
            d.textIn(user, ux + 24, 14, 22, 8.5f, Theme.TEXT, Font.BOLD);
        }
        d.text("Hammer Client " + Hammer.version() + "  ·  Minecraft " + p.minecraftVersion(), 12, ui.h - 15, 7.5f, Theme.DIM, Font.MEDIUM);
        d.textRight("Copyright Mojang AB. Do not distribute!", ui.w - 12, ui.h - 15, 7.5f, Theme.DIM, Font.MEDIUM);
    }

    /** One row of the main list: icon, title, subtitle; the first one is the highlighted "play" action. */
    private static boolean item(Ui ui, String id, String icon, String title, String sub, float x, float y, float w, float h, boolean primary, float delay) {
        Draw d = ui.d;
        float in = ui.enter(delay, 0.45f);
        if (in < 0.02f) return false;
        x -= (1 - in) * 18;
        boolean hot = ui.hover(x, y, w, h);
        float a = ui.hoverAnim("item." + id, hot);
        float grow = 5 * a;
        int textColor;
        int subColor;
        if (primary) {
            d.shadow(x, y + 2, w + grow, h, 8 + 6 * a, Draw.alpha(Theme.accent(), (0.28f + 0.22f * a) * in));
            d.rgradient(x, y, w + grow, h, 9, Draw.alpha(Draw.mix(Theme.accentLight(), 0xFFFFFFFF, 0.2f * a), in), Draw.alpha(Draw.mix(Theme.accentDark(), Theme.accent(), a), in));
            textColor = Draw.alpha(Theme.INK, in);
            subColor = Draw.alpha(0xFF5A2E0C, in);
        } else {
            d.panel(x, y, w + grow, h, 9, Draw.alpha(Draw.mix(0xFF17110B, 0xFF2A2017, a), 0.9f * in), Draw.alpha(Draw.mix(Theme.LINE, Theme.accent(), a), in));
            d.rrect(x, y + 8, 2.5f * a + 0.01f, h - 16, 1.2f, Draw.alpha(Theme.accent(), a * in));
            textColor = Draw.alpha(Theme.TEXT, in);
            subColor = Draw.alpha(Theme.DIM, in);
        }
        float iconBox = h - 14;
        d.rrect(x + 8, y + 7, iconBox, iconBox, 7, primary ? Draw.alpha(0xFF2A1405, 0.16f * in) : Draw.alpha(Theme.accent(), (0.12f + 0.1f * a) * in));
        d.icon(icon, x + 8 + (iconBox - 12) / 2f, y + 7 + (iconBox - 12) / 2f, 12, primary ? textColor : Draw.alpha(Theme.accent(), in));
        float tx = x + iconBox + 18;
        d.text(title, tx, y + 6.5f, 11, textColor, Font.BOLD);
        d.text(d.ellipsis(sub, w - iconBox - 44, 7.5f, Font.MEDIUM), tx, y + 20.5f, 7.5f, subColor, Font.MEDIUM);
        d.icon("right", x + w + grow - 18 + 3 * a, y + (h - 9) / 2f, 9, primary ? textColor : Draw.alpha(Theme.MUTED, (0.35f + 0.65f * a) * in));
        if (ui.click(x, y, w, h)) {
            Hammer.platform().clickSound();
            return true;
        }
        return false;
    }
}
