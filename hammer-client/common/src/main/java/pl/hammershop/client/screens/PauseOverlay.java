package pl.hammershop.client.screens;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Gfx;
import pl.hammershop.client.core.Config;
import pl.hammershop.client.ui.Font;
import pl.hammershop.client.ui.Input;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;
import pl.hammershop.client.ui.UiState;

/** Our buttons on top of the vanilla pause menu (bottom-left corner): the module panel and Discord. */
public final class PauseOverlay {
    private final UiState state = new UiState();
    private final Input noInput = new Input();
    private float[] mods;     // rectangles in GUI pixels, from the last frame
    private float[] discord;

    public void render(Gfx g, float mouseX, float mouseY) {
        Ui ui = new Ui(g, state, noInput, mouseX, mouseY);
        try {
            Config cfg = Hammer.config();
            float s = ui.d.scale();
            float w = 132;
            float x = 12;
            float y = ui.h - 12 - 28;
            boolean hasDiscord = !cfg.discordUrl.isEmpty();
            if (hasDiscord) {
                ui.button("discord", Hammer.t("pause.discord"), "discord", x, y, w, 28, Ui.Style.DISCORD);
                discord = new float[] {x * s, y * s, w * s, 28 * s};
                y -= 34;
            } else discord = null;
            ui.button("mods", Hammer.t("pause.mods"), "puzzle", x, y, w, 28, Ui.Style.PRIMARY);
            mods = new float[] {x * s, y * s, w * s, 28 * s};
            ui.d.text("Hammer Client " + Hammer.version(), x + 2, y - 14, 7.5f, Theme.MUTED, Font.MEDIUM);
            ui.end();
        } catch (RuntimeException e) {
            ui.d.unwind();
            throw e;
        }
    }

    private static boolean in(float[] r, float x, float y) {
        return r != null && x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
    }

    public boolean click(float mouseX, float mouseY) {
        if (in(mods, mouseX, mouseY)) {
            Hammer.platform().clickSound();
            Hammer.open(new ModMenuScreen());
            return true;
        }
        if (in(discord, mouseX, mouseY)) {
            Hammer.platform().clickSound();
            Hammer.platform().openUrl(Hammer.config().discordUrl);
            return true;
        }
        return false;
    }
}
