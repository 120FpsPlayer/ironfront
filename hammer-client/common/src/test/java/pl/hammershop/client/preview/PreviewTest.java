package pl.hammershop.client.preview;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Modules;
import pl.hammershop.client.screens.HudEditorScreen;
import pl.hammershop.client.screens.MainMenuScreen;
import pl.hammershop.client.screens.ModMenuScreen;
import pl.hammershop.client.ui.UiScreen;

import java.io.File;
import java.nio.file.Files;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Renders every screen of the client into build/preview/*.png and checks that nothing throws. */
class PreviewTest {
    static FakePlatform platform;
    static File out;

    @BeforeAll
    static void init() throws Exception {
        platform = new FakePlatform(Files.createTempDirectory("hammer-preview"));
        Files.writeString(platform.dir.resolve("hammerclient-launcher.json"), "{\"discordUrl\":\"https://discord.gg/gRqFb6MmWX\",\"shopUrl\":\"https://hammershop.pl\",\"brand\":\"HammerShop\"}");
        Hammer.init(platform);
        out = new File(System.getProperty("hammer.preview.dir", "build/preview"));
    }

    /** Draws a screen a few frames (so animations settle) and saves the last one. */
    static Java2DGfx shot(String name, UiScreen screen, int w, int h, double guiScale, boolean world, float mouseX, float mouseY) throws Exception {
        Java2DGfx g = null;
        screen.state.opened = System.nanoTime() - 4_000_000_000L;
        for (int frame = 0; frame < 3; frame++) {
            g = new Java2DGfx(w, h, guiScale);
            if (world) fakeWorld(g);
            assertTrue(Hammer.renderScreen(screen, g, mouseX, mouseY), name + " did not draw");
            Thread.sleep(60);
        }
        g.save(new File(out, name + ".png"));
        return g;
    }

    static void fakeWorld(Java2DGfx g) {
        g.gradient(0, 0, g.width(), g.height() * 6 / 10, 0xFF7EB6FF, 0xFFCFE6FF);
        g.gradient(0, g.height() * 6 / 10, g.width(), g.height(), 0xFF5E9E4A, 0xFF2F5E27);
    }

    @Test
    void mainMenu() throws Exception {
        platform.inWorld = false;
        shot("01-menu-1080p", new MainMenuScreen(), 1920, 1080, 4, false, 300, 150);
        shot("02-menu-720p", new MainMenuScreen(), 1280, 720, 2, false, 0, 0);
        shot("03-menu-480p", new MainMenuScreen(), 854, 480, 2, false, 0, 0);
        platform.inWorld = true;
    }

    @Test
    void modMenu() throws Exception {
        shot("04-mods", new ModMenuScreen(), 1920, 1080, 3, true, 280, 150);
        Module keystrokes = Modules.byId("keystrokes");
        shot("05-mod-settings", new ModMenuScreen(keystrokes), 1920, 1080, 3, true, 0, 0);
        ModMenuScreen settings = new ModMenuScreen();
        java.lang.reflect.Field tab = ModMenuScreen.class.getDeclaredField("tab");
        tab.setAccessible(true);
        tab.set(settings, "settings");
        shot("06-client-settings", settings, 1920, 1080, 3, true, 0, 0);
        shot("07-mods-720p", new ModMenuScreen(), 1280, 720, 2, true, 0, 0);
        shot("08-mods-480p", new ModMenuScreen(), 854, 480, 2, true, 0, 0);
    }

    @Test
    void hud() throws Exception {
        for (Module m : Modules.ALL) m.setEnabled(true);
        Java2DGfx g = new Java2DGfx(1920, 1080, 3);
        fakeWorld(g);
        Hammer.renderHud(g);
        Thread.sleep(30);
        g = new Java2DGfx(1920, 1080, 3);
        fakeWorld(g);
        Hammer.renderHud(g);
        g.save(new File(out, "09-hud.png"));
        shot("10-hud-editor", new HudEditorScreen(), 1920, 1080, 3, true, 60, 40);
        Hammer.config().hudFont = "hammer";
        g = new Java2DGfx(1920, 1080, 3);
        fakeWorld(g);
        Hammer.renderHud(g);
        g.save(new File(out, "11-hud-smooth-font.png"));
        Hammer.config().hudFont = "minecraft";
        for (Module m : Modules.ALL) m.data().enabled = null;
        assertEquals(0, Hammer.problemCount(), "a HUD module or screen failed while drawing (see the log)");
    }

    @Test
    void modulesHaveTextsAndIcons() {
        for (Module m : Modules.ALL) {
            assertTrue(!m.name().startsWith("module."), "name of " + m.id);
            assertTrue(!m.description().startsWith("module."), "description of " + m.id);
            assertTrue(pl.hammershop.client.ui.Draw.hasIcon(m.icon), "icon of " + m.id + ": " + m.icon);
            for (var s : m.settings) assertTrue(!s.label().startsWith("setting."), "label of " + m.id + "." + s.id);
        }
        assertEquals(38, Modules.ALL.size());
    }
}
