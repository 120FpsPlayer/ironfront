package pl.hammershop.client.screens;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.core.Config;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;

/** The first time you are in a world with Hammer Client: a short card that says which key opens the module panel. */
public final class WelcomeHint {
    private static final float SECONDS = 12f;
    private static long shownAt;

    private WelcomeHint() {
    }

    public static void render(Draw d) {
        Config cfg = Hammer.config();
        if (cfg.welcomed) return;
        long now = System.nanoTime();
        if (shownAt == 0) shownAt = now;
        float t = (now - shownAt) / 1e9f;
        if (t > SECONDS) {
            cfg.welcomed = true;
            cfg.markDirty();
            return;
        }
        float a = Math.min(1f, t / 0.4f) * Math.min(1f, (SECONDS - t) / 0.6f);
        float s = Ui.uiScale(d.g);
        d.push();
        d.scale(s);
        float w = d.g.width() / s;
        float h = d.g.height() / s;
        String title = Hammer.t("welcome.title");
        String text = Hammer.t("welcome.text", Hammer.platform().keyName(Keys.MENU.id));
        float cw = Math.max(d.textWidth(title, 11, Font.BOLD), d.textWidth(text, 8.5f, Font.MEDIUM)) + 62;
        float x = (w - cw) / 2f;
        float y = h * 0.2f - (1 - a) * 8;
        d.shadow(x, y, cw, 44, 12, Draw.alpha(0xFF000000, 0.45f * a));
        d.panel(x, y, cw, 44, 10, Draw.alpha(0xFF140E08, 0.92f * a), Draw.alpha(Theme.accent(), 0.7f * a));
        d.image("logo", 256, 256, x + 9, y + 8, 28, 28, (Math.round(a * 255) << 24) | 0xFFFFFF);
        d.text(title, x + 46, y + 8.5f, 11, Draw.alpha(Theme.TEXT, a), Font.BOLD);
        d.text(text, x + 46, y + 25, 8.5f, Draw.alpha(Theme.MUTED, a), Font.MEDIUM);
        // a thin bar that runs out with the time left
        d.rrect(x + 10, y + 40, (cw - 20) * (1f - t / SECONDS), 1.5f, 0.75f, Draw.alpha(Theme.accent(), 0.8f * a));
        d.pop();
    }
}
