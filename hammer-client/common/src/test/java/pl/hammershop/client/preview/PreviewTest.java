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
        assertEquals(55, Modules.ALL.size());
    }

    @Test
    void tabBadges() {
        var P = pl.hammershop.client.core.Presence.class;
        var cfg = Hammer.config();
        String me = platform.playerUuid();
        String other = "11111111111141118111111111111111";
        String plus = "22222222222242228222222222222222";
        String nobody = "33333333333343338333333333333333";
        pl.hammershop.client.core.Presence.clear();
        try {
            // Your own name: H, or H+ with Hammer+ – also without any server.
            assertEquals(1, Hammer.tabBadge(me, true));
            cfg.plusActive = true;
            assertEquals(2, Hammer.tabBadge(me, true));
            cfg.plusActive = false;
            // Others: nothing without a server, and nothing until it has answered.
            assertEquals(0, Hammer.tabBadge(other, false));
            cfg.api = "https://example.invalid/api/launcher";
            assertEquals(0, Hammer.tabBadge(other, false));
            pl.hammershop.client.core.Presence.accept(java.util.List.of(other, plus, nobody), "{\"players\":{\"" + other + "\":\"h\",\"" + plus + "\":\"p\",\"x\":\"p\"}}");
            assertEquals(1, Hammer.tabBadge(other, false));
            assertEquals(2, Hammer.tabBadge(plus, false));
            assertEquals(0, Hammer.tabBadge(nobody, false));
            // Offline-mode ids (not version 4) and broken ids never get one.
            assertEquals(0, Hammer.tabBadge("11111111111131118111111111111111", false));
            assertEquals(0, Hammer.tabBadge("steve", false));
            assertEquals(0, Hammer.tabBadge(null, false));
            // The "players online" HUD counts them: me and the two others on the list.
            assertEquals(3, pl.hammershop.client.core.Presence.count(platform.online, me));
            // What is sent: who I am (or null when I do not want to be shown) and who I ask about.
            assertEquals("{\"me\":\"" + me + "\",\"uuids\":[\"" + other + "\"]}", pl.hammershop.client.core.Presence.request(me, java.util.List.of(other)));
            assertEquals("{\"me\":null,\"uuids\":[]}", pl.hammershop.client.core.Presence.request("", java.util.List.of()));
            // A broken answer changes nothing and is reported to the caller.
            org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> pl.hammershop.client.core.Presence.accept(java.util.List.of(other), "<html>502</html>"));
            org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> pl.hammershop.client.core.Presence.accept(java.util.List.of(other), "{\"capes\":{}}"));
            assertEquals(1, Hammer.tabBadge(other, false));
            // The module switched off: no badge anywhere, not even your own.
            Modules.tabBadge.setEnabled(false);
            assertEquals(0, Hammer.tabBadge(me, true));
            assertEquals(0, Hammer.tabBadge(plus, false));
        } finally {
            Modules.tabBadge.data().enabled = null;
            cfg.api = "";
            cfg.plusActive = false;
            pl.hammershop.client.core.Presence.clear();
        }
        assertTrue(P != null);
    }

    @Test
    void everyChoiceOptionHasAText() {
        for (Module m : Modules.ALL) {
            for (var s : m.settings) {
                if (!(s instanceof pl.hammershop.client.module.Setting.Choice c)) continue;
                for (String option : c.options) assertTrue(pl.hammershop.client.core.Lang.has("option." + option), "text of option " + option + " (" + m.id + ")");
            }
        }
        for (String id : pl.hammershop.client.core.Config.HUD_STYLES) assertTrue(pl.hammershop.client.core.Lang.has("option.hud_" + id), id);
        for (String id : pl.hammershop.client.core.Config.MENU_BACKGROUNDS) assertTrue(pl.hammershop.client.core.Lang.has("option.bg_" + id), id);
        for (String id : pl.hammershop.client.core.Capes.KNOWN) assertTrue(pl.hammershop.client.core.Lang.has("cape." + id), id);
    }

    @Test
    void waypoints() throws Exception {
        var W = pl.hammershop.client.core.Waypoints.class;
        String world = platform.worldKey();
        for (var p : new java.util.ArrayList<>(pl.hammershop.client.core.Waypoints.of(world))) pl.hammershop.client.core.Waypoints.remove(world, p);
        var home = pl.hammershop.client.core.Waypoints.here(platform, "Dom", 0xFFFF9F43);
        home.x += 14;
        home.z -= 60;
        var mine = pl.hammershop.client.core.Waypoints.here(platform, "Kopalnia diamentów", 0xFF5CA8FF);
        mine.x -= 40;
        mine.z -= 90;
        mine.y = 12;
        var portal = pl.hammershop.client.core.Waypoints.here(platform, "Portal", 0xFFB18CFF);
        portal.dim = "minecraft:the_nether";
        var hidden = pl.hammershop.client.core.Waypoints.here(platform, "Farma", 0xFF5EE08D);
        hidden.visible = false;
        for (var p : java.util.List.of(home, mine, portal, hidden)) assertTrue(pl.hammershop.client.core.Waypoints.add(world, p));
        // dying leaves exactly one death point, however often it happens
        var stats = new pl.hammershop.client.core.Stats();
        for (int i = 0; i < 2; i++) {
            platform.health = 18;
            stats.tick(platform);
            platform.health = 0;
            stats.tick(platform);
            stats.tick(platform);
        }
        platform.health = 18;
        assertEquals(2, stats.deaths());
        assertEquals(1, pl.hammershop.client.core.Waypoints.of(world).stream().filter(p -> p.death).count());
        assertEquals(5, pl.hammershop.client.core.Waypoints.of(world).size());

        shot("12-waypoints", new pl.hammershop.client.screens.WaypointsScreen(), 1920, 1080, 3, true, 0, 0);
        shot("13-waypoints-480p", new pl.hammershop.client.screens.WaypointsScreen(), 854, 480, 2, true, 0, 0);
        Java2DGfx g = new Java2DGfx(1920, 1080, 3);
        fakeWorld(g);
        Hammer.renderHud(g);
        g.save(new File(out, "14-waypoints-hud.png"));

        // saved and read back
        pl.hammershop.client.core.Waypoints.save();
        assertTrue(Files.exists(platform.dir.resolve("hammerclient/waypoints.json")));
        pl.hammershop.client.core.Waypoints.load(platform.dir);
        assertEquals(5, pl.hammershop.client.core.Waypoints.of(world).size());
        assertEquals("Dom", pl.hammershop.client.core.Waypoints.of(world).get(0).name);
        assertEquals(0, Hammer.problemCount());
        assertTrue(W != null);
    }

    @Test
    void wholeHudCanBeShrunk() throws Exception {
        var cfg = Hammer.config();
        for (Module m : Modules.ALL) m.setEnabled(true);
        Java2DGfx g = new Java2DGfx(1280, 720, 3);
        fakeWorld(g);
        Hammer.renderHud(g);
        var fps = (pl.hammershop.client.module.HudModule) Modules.byId("fps");
        fps.scale.reset();
        float full = fps.scaledW();
        assertTrue(full > 10);
        cfg.setHudScale(0.6f);
        assertEquals(0.6f, cfg.hudScaleInUse(), 0.001f);
        assertEquals(full * 0.6f, fps.scaledW(), 0.01f);
        fps.scale.set(2f);
        assertEquals(full * 1.2f, fps.scaledW(), 0.01f, "a module's own size still counts");
        fps.scale.reset();
        g = new Java2DGfx(1280, 720, 3);
        fakeWorld(g);
        Hammer.renderHud(g);
        g = new Java2DGfx(1280, 720, 3);
        fakeWorld(g);
        Hammer.renderHud(g);
        g.save(new File(out, "22-hud-60-percent.png"));
        shot("23-hud-editor-60-percent", new HudEditorScreen(), 1280, 720, 3, true, 0, 0);
        // out-of-range and broken values are brought back into range
        cfg.setHudScale(9f);
        assertEquals(1.5f, cfg.hudScaleInUse(), 0.001f);
        cfg.setHudScale(0.01f);
        assertEquals(0.5f, cfg.hudScaleInUse(), 0.001f);
        cfg.hudScale = Float.NaN;
        assertEquals(1f, cfg.hudScaleInUse(), 0.001f);
        cfg.hudScale = 1f;
        g = new Java2DGfx(1280, 720, 3);
        fakeWorld(g);
        Hammer.renderHud(g);
        g.save(new File(out, "22-hud-100-percent.png"));
        for (Module m : Modules.ALL) m.data().enabled = null;
        assertEquals(0, Hammer.problemCount());
    }

    @Test
    void everyModuleHasItsOwnSize() throws Exception {
        // only two modules on the screen, so "empty space" really is empty
        for (Module m : Modules.ALL) m.setEnabled(false);
        var fps = (pl.hammershop.client.module.HudModule) Modules.byId("fps");
        var cps = (pl.hammershop.client.module.HudModule) Modules.byId("cps");
        fps.setEnabled(true);
        cps.setEnabled(true);
        fps.scale.reset();
        cps.scale.reset();
        Hammer.input().reset();
        HudEditorScreen editor = new HudEditorScreen();
        editor.state.opened = System.nanoTime() - 4_000_000_000L;
        Java2DGfx g = new Java2DGfx(1280, 720, 3);
        assertTrue(Hammer.renderScreen(editor, g, 0, 0));
        assertTrue(Hammer.renderScreen(editor, g, 0, 0));
        assertEquals(null, editor.selected());
        // a click on the FPS module selects it …
        float x = fps.left(g.width()) + 3;
        float y = fps.top(g.height()) + 3;
        Hammer.input().mouseDown(0);
        assertTrue(Hammer.renderScreen(editor, g, x, y));
        Hammer.input().mouseUp(0);
        assertTrue(Hammer.renderScreen(editor, g, x, y));
        assertEquals(fps, editor.selected());
        assertTrue(!fps.placed(), "a click only selects – the module stays in its automatic stack");
        // … and its buttons change only that module
        editor.resizeSelected(0.25f);
        assertEquals(1.25f, fps.scale.value(), 0.001f);
        assertEquals(1f, cps.scale.value(), 0.001f);
        editor.resizeSelected(-0.5f);
        assertEquals(0.75f, fps.scale.value(), 0.001f);
        editor.resizeSelected(-9f);
        assertEquals(fps.scale.min, fps.scale.value(), 0.001f, "never smaller than the limit");
        editor.resizeSelected(9f);
        assertEquals(fps.scale.max, fps.scale.value(), 0.001f, "never bigger than the limit");
        fps.scale.set(1.5f);
        // the "+" button next to the module: one press = one step
        g = new Java2DGfx(1280, 720, 3);
        fakeWorld(g);
        assertTrue(Hammer.renderScreen(editor, g, 0, 0));
        float s = pl.hammershop.client.ui.Ui.uiScale(g);
        float tbx = (fps.left(g.width()) + fps.scaledW()) / s + 8;
        float tby = Math.max(2, (fps.top(g.height()) + fps.scaledH() / 2f) / s - 11);
        float plusX = (tbx + 92 - 14) * s;
        float plusY = (tby + 11) * s;
        Hammer.input().mouseDown(0);
        assertTrue(Hammer.renderScreen(editor, g, plusX, plusY));
        Hammer.input().mouseUp(0);
        assertTrue(Hammer.renderScreen(editor, g, plusX, plusY));
        assertEquals(1.55f, fps.scale.value(), 0.001f, "the + button");
        assertEquals(fps, editor.selected(), "pressing a size button keeps the module selected");
        assertEquals(1f, cps.scale.value(), 0.001f);
        // a clean, settled frame for the picture
        for (int i = 0; i < 2; i++) {
            g = new Java2DGfx(1280, 720, 3);
            fakeWorld(g);
            assertTrue(Hammer.renderScreen(editor, g, plusX, plusY));
        }
        g.save(new File(out, "24-hud-editor-selected.png"));
        // dragging the corner handle resizes it too
        float hx = fps.left(g.width()) + fps.scaledW();
        float hy = fps.top(g.height()) + fps.scaledH();
        float before = fps.scale.value();
        Hammer.input().mouseDown(0);
        assertTrue(Hammer.renderScreen(editor, g, hx, hy));
        assertTrue(Hammer.renderScreen(editor, g, hx * 0.6f, hy * 0.6f));
        Hammer.input().mouseUp(0);
        assertTrue(Hammer.renderScreen(editor, g, hx * 0.6f, hy * 0.6f));
        assertTrue(fps.scale.value() < before - 0.2f, "dragging the handle towards the corner makes it smaller: " + fps.scale.value());
        assertEquals(1f, cps.scale.value(), 0.001f);
        // the neighbour moved down to make room, nothing overlaps
        assertTrue(cps.top(g.height()) >= fps.top(g.height()) + fps.scaledH(), "CPS sits below the resized FPS");
        // pressing and moving the mouse drags the module to a place of its own
        float dx = fps.left(g.width()) + 3;
        float dy = fps.top(g.height()) + 3;
        Hammer.input().mouseDown(0);
        assertTrue(Hammer.renderScreen(editor, g, dx, dy));
        assertTrue(Hammer.renderScreen(editor, g, dx + 120, dy + 90));
        Hammer.input().mouseUp(0);
        assertTrue(Hammer.renderScreen(editor, g, dx + 120, dy + 90));
        assertTrue(fps.placed(), "dragging places the module");
        assertTrue(fps.left(g.width()) > 100 && fps.top(g.height()) > 70, fps.left(g.width()) + ", " + fps.top(g.height()));
        fps.resetPosition();
        // a click on empty space takes the selection away
        Hammer.input().mouseDown(0);
        assertTrue(Hammer.renderScreen(editor, g, g.width() - 5, g.height() / 2f - 60));
        Hammer.input().mouseUp(0);
        assertTrue(Hammer.renderScreen(editor, g, g.width() - 5, g.height() / 2f - 60));
        assertEquals(null, editor.selected());
        fps.scale.reset();
        for (Module m : Modules.ALL) m.data().enabled = null;
        Hammer.input().reset();
        assertEquals(0, Hammer.problemCount());
    }

    @Test
    void projection() {
        // Looking south (yaw 0): +Z is ahead, east (+X) is on the left, up is up.
        float[] ahead = pl.hammershop.client.core.Waypoints.project(0, 0, 10, 0, 0, 0, 0f, 0f, 70, 1920, 1080);
        assertEquals(960f, ahead[0], 0.01f);
        assertEquals(540f, ahead[1], 0.01f);
        assertTrue(pl.hammershop.client.core.Waypoints.project(5, 0, 10, 0, 0, 0, 0f, 0f, 70, 1920, 1080)[0] < 960f, "east is left when facing south");
        assertTrue(pl.hammershop.client.core.Waypoints.project(0, 5, 10, 0, 0, 0, 0f, 0f, 70, 1920, 1080)[1] < 540f, "higher is higher on screen");
        assertTrue(pl.hammershop.client.core.Waypoints.project(0, 0, -10, 0, 0, 0, 0f, 0f, 70, 1920, 1080) == null, "behind the camera");
        // Facing west (yaw 90): -X is ahead and north (-Z) is on the right.
        float[] west = pl.hammershop.client.core.Waypoints.project(-10, 0, -3, 0, 0, 0, 90f, 0f, 70, 1920, 1080);
        assertTrue(west[0] > 960f);
        // Looking down 45°: the horizon is above the middle; a point at the top edge of a 90° view sits on that edge.
        assertTrue(pl.hammershop.client.core.Waypoints.project(0, 0, 10, 0, 0, 0, 0f, 45f, 70, 1920, 1080)[1] < 540f);
        float[] edge = pl.hammershop.client.core.Waypoints.project(0, 10, 10, 0, 0, 0, 0f, 0f, 90, 1920, 1080);
        assertEquals(0f, edge[1], 0.01f);
    }

    @Test
    void killsAreCountedOnce() {
        var stats = new pl.hammershop.client.core.Stats();
        stats.tick(platform);
        stats.attacked(2.5, 77);
        stats.tick(platform);
        assertEquals(0, stats.kills());
        assertTrue(stats.sinceHit() < 1000);
        platform.dead.add(77);
        stats.tick(platform);
        stats.tick(platform);
        assertEquals(1, stats.kills(), "the dead target counts once");
        stats.attacked(2.5, 78);
        stats.tick(platform);
        assertEquals(1, stats.kills(), "a living target is not a kill");
        platform.dead.clear();
    }

    @Test
    void benchmarkNumbers() {
        assertEquals(0, pl.hammershop.client.core.Benchmark.seconds(null));
        assertEquals(0, pl.hammershop.client.core.Benchmark.seconds("abc"));
        assertEquals(0, pl.hammershop.client.core.Benchmark.seconds("0"));
        assertEquals(5, pl.hammershop.client.core.Benchmark.seconds("1"));
        assertEquals(30, pl.hammershop.client.core.Benchmark.seconds(" 30 "));
        assertEquals(180, pl.hammershop.client.core.Benchmark.seconds("9999"));
        // 198 frames of 5 ms and 2 of 50 ms: average 1 / 5.45 ms, 1% low = the two slow frames
        float[] times = new float[200];
        java.util.Arrays.fill(times, 0.005f);
        times[10] = 0.05f;
        times[150] = 0.05f;
        double[] s = pl.hammershop.client.core.Benchmark.summary(times, 200);
        assertEquals(200 / 1.09, s[0], 0.2);
        assertEquals(20.0, s[1], 0.01);
        assertEquals(20.0, s[2], 0.01);
        assertEquals(200.0, s[3], 0.01);
        assertEquals(0.0, pl.hammershop.client.core.Benchmark.summary(times, 0)[0]);
        assertTrue(!pl.hammershop.client.core.Benchmark.running(), "no test without the launcher's switch");
    }

    @Test
    void capes() {
        var cfg = Hammer.config();
        String me = "0123456789ab4def0123456789abcdef";
        String other = "aaaaaaaaaaaa4aaaaaaaaaaaaaaaaaaa";
        String third = "bbbbbbbbbbbb4bbbbbbbbbbbbbbbbbbb";
        String offline = "cccccccccccc3ccccccccccccccccccc";
        cfg.cape = "gold";
        cfg.plusActive = false;
        assertEquals(null, Hammer.cape(me, true), "a Hammer+ cape needs Hammer+");
        cfg.cape = "ember";
        assertEquals("ember", Hammer.cape(me, true), "Żar is for everybody");
        cfg.cape = "hammer";
        assertEquals("hammer", Hammer.cape(me, true), "and so is Hammer");
        // One's own picture (Hammer+): loaded once from config/hammerclient/cape.png as textures/capes/custom.png.
        cfg.cape = "custom";
        assertEquals(null, Hammer.cape(me, true), "one's own cape needs Hammer+");
        cfg.cape = "gold";
        cfg.plusActive = true;
        assertEquals("gold", Hammer.cape(me, true));
        cfg.plusUntil = System.currentTimeMillis() / 1000 - 10;
        assertEquals(null, Hammer.cape(me, true), "Hammer+ ran out");
        cfg.plusUntil = 0;
        cfg.cape = "nope";
        assertEquals(null, Hammer.cape(me, true), "unknown cape");
        try {
            java.nio.file.Path capeFile = cfg.customCapeImage();
            java.nio.file.Files.createDirectories(capeFile.getParent());
            java.nio.file.Files.write(capeFile, new byte[] {1, 2, 3});
            platform.imageSize = new int[] {128, 64};
            cfg.cape = "custom";
            assertEquals("custom", Hammer.cape(me, true));
            assertEquals("custom", Hammer.cape(me, true));
            assertEquals(1, platform.loaded.stream().filter("capes/custom"::equals).count(), "the picture is loaded once");
            java.nio.file.Files.delete(capeFile);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        } finally {
            platform.imageSize = null;
        }
        cfg.cape = "";
        cfg.plusActive = false;

        // other players: only what the shop's server said, and only when the player allows asking
        cfg.api = "";
        assertEquals(null, Hammer.cape(other, false));
        cfg.api = "https://shop.invalid/api/launcher";
        assertEquals(null, Hammer.cape(other, false), "not known yet");
        pl.hammershop.client.core.Capes.accept(java.util.List.of(other, third), "{\"capes\":{\"" + other + "\":\"ember\",\"" + third + "\":\"<script>\"}}");
        assertEquals("ember", Hammer.cape(other, false));
        assertEquals(null, Hammer.cape(third, false), "a cape we do not ship is ignored");
        assertEquals(null, Hammer.cape(offline, false), "offline accounts are never asked about");
        cfg.otherCapes = false;
        assertEquals(null, Hammer.cape(other, false));
        cfg.otherCapes = true;
        cfg.api = "";
        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> pl.hammershop.client.core.Capes.accept(java.util.List.of(other), "[]"));
    }

    @Test
    void cosmeticsAreBuiltFromTheirFile() throws Exception {
        // every cosmetic of the file: quads with texture coordinates inside its texture, on the head or the body
        var items = pl.hammershop.client.core.Cosmetics.items();
        assertEquals(java.util.List.of("angel", "dragon", "halo", "crown", "tophat", "santa"), items.stream().map(i -> i.id).toList());
        for (var item : items) {
            assertTrue(getClass().getResource("/assets/hammerclient/" + item.texture()) != null, item.id + " has a texture");
            for (var part : item.parts) {
                assertTrue(part.vertices() > 0 && part.vertices() % 4 == 0, item.id);
                for (int i = 0; i < part.quads.length; i += pl.hammershop.client.core.Cosmetics.STRIDE) {
                    float u = part.quads[i + 3];
                    float v = part.quads[i + 4];
                    assertTrue(u >= 0 && u <= 1 && v >= 0 && v <= 1, item.id + " uv " + u + "," + v);
                    float n = part.quads[i + 5] * part.quads[i + 5] + part.quads[i + 6] * part.quads[i + 6] + part.quads[i + 7] * part.quads[i + 7];
                    assertEquals(1f, n, 1e-4f, item.id + " normal");
                }
            }
        }
        // a flat wing is two faces (front and back), not six
        var angel = pl.hammershop.client.core.Cosmetics.item("angel");
        assertEquals(2, angel.parts.size());
        assertEquals(8, angel.parts.get(0).vertices());
        assertEquals(pl.hammershop.client.core.Cosmetics.Bone.BODY, angel.parts.get(0).bone);
        // the halo: a closed golden ring above the head that glows
        var halo = pl.hammershop.client.core.Cosmetics.item("halo");
        assertTrue(halo.glow);
        float minX = 9, maxX = -9, minZ = 9, maxZ = -9;
        for (var part : halo.parts) {
            assertEquals(pl.hammershop.client.core.Cosmetics.Bone.HEAD, part.bone);
            assertTrue(part.py < -0.7f, "above the head (the head's top is at -0.5)");
            for (int i = 0; i < part.quads.length; i += pl.hammershop.client.core.Cosmetics.STRIDE) {
                minX = Math.min(minX, part.quads[i]);
                maxX = Math.max(maxX, part.quads[i]);
                minZ = Math.min(minZ, part.quads[i + 2]);
                maxZ = Math.max(maxZ, part.quads[i + 2]);
            }
        }
        assertEquals(minX, -maxX, 0.01f, "round");
        assertEquals(minZ, -maxZ, 0.01f, "round");
        // hats sit on the head, outside the second skin layer (which is 0.5 pixel bigger than the head)
        for (String id : new String[] {"crown", "tophat", "santa"}) {
            var hat = pl.hammershop.client.core.Cosmetics.item(id);
            assertEquals("hat", hat.slot);
            float lowest = -9;
            for (var part : hat.parts) for (int i = 0; i < part.quads.length; i += pl.hammershop.client.core.Cosmetics.STRIDE) lowest = Math.max(lowest, part.quads[i + 1]);
            assertTrue(lowest <= 0, id + " stays on the head");
            float lift = pl.hammershop.client.core.Cosmetics.haloLift(hat);
            assertTrue(halo.bottom + lift + 0.7f / 16 < hat.top, "the halo floats above the " + id + " (even when it bobs down)");
        }
        assertEquals(0f, pl.hammershop.client.core.Cosmetics.haloLift(null), "without a hat the halo stays where it is");
        // the same box layout as Minecraft's: a 8×8×8 head box at texture 0,0 has its face at 8,8–16,16 (64×64)
        var quads = new java.util.ArrayList<float[]>();
        java.lang.reflect.Method box = pl.hammershop.client.core.Cosmetics.class.getDeclaredMethod("box", java.util.List.class, float[].class, float[].class, float[].class, float.class, boolean.class, float.class, float.class, float.class);
        box.setAccessible(true);
        box.invoke(null, quads, new float[] {-4, -8, -4}, new float[] {8, 8, 8}, new float[] {0, 0}, 0f, false, 1f, 64f, 64f);
        assertEquals(6, quads.size());
        float[] front = quads.get(3); // north: the face
        assertEquals(-1f, front[22]);
        java.util.Set<String> corners = new java.util.TreeSet<>();
        for (int v = 0; v < 4; v++) corners.add(front[v * 5 + 3] * 64 + "," + front[v * 5 + 4] * 64);
        assertEquals(java.util.Set.of("8.0,8.0", "16.0,8.0", "8.0,16.0", "16.0,16.0"), corners);

        // moving capes: strips of frames, known to the client and shown in turn
        for (String id : new String[] {"flame", "sparks", "waves"}) {
            var cape = pl.hammershop.client.core.Cosmetics.movingCape(id);
            assertTrue(cape != null && cape.frames() >= 8 && cape.frames() <= 16 && cape.fps() == 10, id);
            assertTrue(pl.hammershop.client.core.Capes.known(id));
            var strip = javax.imageio.ImageIO.read(getClass().getResource("/assets/hammerclient/textures/capes/" + id + ".png"));
            assertEquals(strip.getWidth() / 2 * cape.frames(), strip.getHeight(), id + " is a strip of " + cape.frames() + " cape pictures");
            assertEquals(0, cape.frameAt(0));
            assertEquals(1, cape.frameAt(100));
            assertEquals(0, cape.frameAt(1000L * cape.frames() / cape.fps()), "a loop");
        }
        assertEquals(null, pl.hammershop.client.core.Cosmetics.movingCape("gold"), "a still cape");
        // the cape lists name the same moving capes
        String list = new String(getClass().getResourceAsStream("/assets/hammerclient/capes.json").readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        for (String id : new String[] {"flame", "sparks", "waves"}) assertTrue(list.contains("\"id\": \"" + id + "\""), id);
    }

    @Test
    void wingsBeatFasterWhenFlying() {
        var wing = pl.hammershop.client.core.Cosmetics.item("angel").parts.get(0);
        var other = pl.hammershop.client.core.Cosmetics.item("angel").parts.get(1);
        float[] a = new float[6];
        float[] b = new float[6];
        double idleMin = 9, idleMax = -9, flyMin = 9, flyMax = -9;
        for (float t = 0; t < 120; t += 0.5f) {
            pl.hammershop.client.core.Cosmetics.animate(wing, t, 0, a);
            pl.hammershop.client.core.Cosmetics.animate(other, t, 0, b);
            assertEquals(a[4], -b[4], 1e-6f, "the wings move as mirror images");
            assertTrue(a[4] < 0, "folded backwards (+z) – the left wing turns the other way round the y axis");
            idleMin = Math.min(idleMin, a[5]);
            idleMax = Math.max(idleMax, a[5]);
            pl.hammershop.client.core.Cosmetics.animate(wing, t, 1, a);
            flyMin = Math.min(flyMin, a[5]);
            flyMax = Math.max(flyMax, a[5]);
        }
        assertTrue(flyMax - flyMin > 3 * (idleMax - idleMin), "big beats while flying, gentle ones on the ground");
        // the halo floats up and down, less than a pixel
        var halo = pl.hammershop.client.core.Cosmetics.item("halo").parts.get(0);
        float lo = 9, hi = -9;
        for (float t = 0; t < 64; t++) {
            pl.hammershop.client.core.Cosmetics.animate(halo, t, 0, a);
            lo = Math.min(lo, a[1]);
            hi = Math.max(hi, a[1]);
            assertEquals(0f, a[4]);
        }
        assertTrue(hi - lo > 0.05f && hi - lo < 0.1f);
    }

    @Test
    void cosmeticsNeedHammerPlusAndComeFromTheShop() throws Exception {
        var cfg = Hammer.config();
        String me = "0123456789ab4def0123456789abcdef";
        String other = "abababababab4abababababababababa";
        String old = "acacacacacac4acacacacacacacacaca";
        // your own: from the launcher's file, only with Hammer+
        Files.writeString(platform.dir.resolve("hammerclient-launcher.json"), "{\"plus\":{\"active\":true,\"until\":0},\"cape\":\"flame\",\"cosmetics\":{\"wings\":\"angel\",\"halo\":true,\"hat\":\"<b>\"}}");
        var fresh = pl.hammershop.client.core.Config.load(platform.dir);
        assertEquals("angel", fresh.wings);
        assertTrue(fresh.halo);
        assertEquals("", fresh.hat, "not an id");
        Files.writeString(platform.dir.resolve("hammerclient-launcher.json"), "{\"discordUrl\":\"https://discord.gg/gRqFb6MmWX\",\"shopUrl\":\"https://hammershop.pl\",\"brand\":\"HammerShop\"}");
        cfg.wings = "dragon";
        cfg.halo = true;
        cfg.hat = "crown";
        cfg.cape = "flame";
        cfg.plusActive = false;
        assertEquals(null, Hammer.look(me, true), "cosmetics are Hammer+");
        assertEquals(null, Hammer.cape(me, true), "and so are moving capes");
        cfg.plusActive = true;
        cfg.plusUntil = 0;
        assertEquals(new pl.hammershop.client.core.Cosmetics.Look(null, "dragon", true, "crown"), Hammer.look(me, true));
        assertEquals("flame", Hammer.cape(me, true));
        cfg.hat = "angel";
        assertEquals(null, Hammer.look(me, true).hat(), "wings are not a hat");
        ModMenuScreen scrolled = settingsTab();
        for (String field : new String[] {"scroll", "scrollTarget"}) {
            java.lang.reflect.Field f = pl.hammershop.client.ui.UiState.class.getDeclaredField(field);
            f.setAccessible(true);
            @SuppressWarnings("unchecked")
            java.util.Map<String, Float> m = (java.util.Map<String, Float>) f.get(scrolled.state);
            m.put("client", 520f);
        }
        shot("06b-client-settings-cosmetics", scrolled, 1920, 1080, 3, true, 0, 0);
        cfg.wings = "";
        cfg.halo = false;
        cfg.hat = "";
        cfg.cape = "";
        cfg.plusActive = false;

        // other players: the server's "looks" (newer servers) say everything, "capes" alone is what older ones send
        cfg.api = "https://shop.invalid/api/launcher";
        cfg.otherCapes = true;
        cfg.otherCosmetics = true;
        pl.hammershop.client.core.Capes.accept(java.util.List.of(other, old), "{\"capes\":{\"" + other + "\":\"ember\",\"" + old + "\":\"gold\"},\"looks\":{\"" + other
                + "\":{\"cape\":\"flame\",\"wings\":\"angel\",\"halo\":true,\"hat\":\"tophat\"}}}");
        assertEquals("flame", Hammer.cape(other, false), "the moving cape, not the still one older clients get");
        assertEquals(new pl.hammershop.client.core.Cosmetics.Look("flame", "angel", true, "tophat"), Hammer.look(other, false));
        assertEquals("gold", Hammer.cape(old, false), "not in looks: the cape list counts");
        assertEquals(null, Hammer.look(old, false));
        pl.hammershop.client.core.Capes.accept(java.util.List.of(other), "{\"capes\":{},\"looks\":{\"" + other + "\":{\"cape\":\"<x>\",\"wings\":\"tophat\",\"halo\":\"yes\",\"hat\":\"santa\"}}}");
        assertEquals(null, Hammer.cape(other, false), "unknown ids are dropped");
        assertEquals(new pl.hammershop.client.core.Cosmetics.Look(null, null, false, "santa"), Hammer.look(other, false));
        cfg.otherCosmetics = false;
        assertEquals(null, Hammer.look(other, false), "the player turned them off");
        cfg.otherCosmetics = true;
        cfg.api = "";
    }

    private static ModMenuScreen settingsTab() throws Exception {
        ModMenuScreen settings = new ModMenuScreen();
        java.lang.reflect.Field tab = ModMenuScreen.class.getDeclaredField("tab");
        tab.setAccessible(true);
        tab.set(settings, "settings");
        return settings;
    }

    @Test
    void capesOfOtherPlayersComeFromTheShop() throws Exception {
        var cfg = Hammer.config();
        String withCape = "dddddddddddd4ddddddddddddddddddd";
        String without = "eeeeeeeeeeee4eeeeeeeeeeeeeeeeeee";
        java.util.List<String> asked = new java.util.concurrent.CopyOnWriteArrayList<>();
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/launcher/capes", ex -> {
            asked.add(ex.getRequestURI().getQuery());
            byte[] body = ("{\"capes\":{\"" + withCape + "\":\"frost\"}}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
        try {
            cfg.api = "http://127.0.0.1:" + server.getAddress().getPort() + "/api/launcher";
            cfg.otherCapes = true;
            assertEquals(null, Hammer.cape(withCape, false), "asked in the background, never while drawing");
            assertEquals(null, Hammer.cape(without, false));
            long end = System.currentTimeMillis() + 8000;
            while (System.currentTimeMillis() < end && Hammer.cape(withCape, false) == null) {
                for (int i = 0; i < 40; i++) pl.hammershop.client.core.Capes.tick();
                Thread.sleep(50);
            }
            assertEquals("frost", Hammer.cape(withCape, false));
            assertEquals(null, Hammer.cape(without, false));
            assertEquals(1, asked.size(), "one request for both players");
            assertTrue(asked.get(0).startsWith("uuids=") && asked.get(0).contains(withCape) && asked.get(0).contains(without), asked.get(0));
            // known answers are not asked for again
            for (int i = 0; i < 200; i++) pl.hammershop.client.core.Capes.tick();
            Thread.sleep(200);
            assertEquals(1, asked.size());
        } finally {
            server.stop(0);
            cfg.api = "";
        }
    }

    @Test
    void hammerPlus() throws Exception {
        var cfg = Hammer.config();
        Module crosshair = Modules.byId("crosshair");
        var style = (pl.hammershop.client.module.Setting.Choice) crosshair.settings.stream().filter(s -> s.id.equals("crosshair_style")).findFirst().orElseThrow();
        var anim = (pl.hammershop.client.module.Setting.Choice) crosshair.settings.stream().filter(s -> s.id.equals("crosshair_anim")).findFirst().orElseThrow();

        // without Hammer+: premium choices fall back, the stored choice is kept for later
        cfg.plusActive = false;
        style.set(7);
        anim.set(3);
        cfg.hudStyle = "neon";
        cfg.menuBackground = "aurora";
        assertEquals(0, (int) style.get());
        assertEquals(0, (int) anim.get());
        assertTrue(style.locked(5) && !style.locked(4));
        assertEquals("classic", cfg.hudStyleInUse());
        assertEquals("default", cfg.menuBackgroundInUse());
        style.set(3);
        assertEquals(3, (int) style.get(), "free shapes work without Hammer+");
        style.set(7);
        shot("15-crosshair-locked", new ModMenuScreen(crosshair), 1920, 1080, 3, true, 0, 0);

        // with Hammer+
        cfg.plusActive = true;
        cfg.plusUntil = 1900000000L;
        cfg.cape = "royal";
        assertTrue(Hammer.plus());
        assertEquals(7, (int) style.get());
        assertEquals(3, (int) anim.get());
        assertEquals("neon", cfg.hudStyleInUse());
        assertEquals("aurora", cfg.menuBackgroundInUse());
        platform.inWorld = false;
        shot("16-menu-plus-aurora", new MainMenuScreen(), 1920, 1080, 4, false, 0, 0);
        for (String bg : new String[] {"night", "lava", "gold", "custom"}) {
            cfg.menuBackground = bg;
            shot("17-menu-plus-" + bg, new MainMenuScreen(), 1280, 720, 2, false, 0, 0);
        }
        platform.inWorld = true;
        ModMenuScreen settings = new ModMenuScreen();
        java.lang.reflect.Field tab = ModMenuScreen.class.getDeclaredField("tab");
        tab.setAccessible(true);
        tab.set(settings, "settings");
        shot("18-client-settings-plus", settings, 1920, 1080, 3, true, 0, 0);
        shot("19-crosshair-plus", new ModMenuScreen(crosshair), 1920, 1080, 3, true, 0, 0);
        for (Module m : Modules.ALL) m.setEnabled(true);
        for (String hud : new String[] {"glass", "neon", "outline"}) {
            cfg.hudStyle = hud;
            Java2DGfx g = new Java2DGfx(1920, 1080, 3);
            fakeWorld(g);
            Hammer.renderHud(g);
            g.save(new File(out, "20-hud-" + hud + ".png"));
        }
        // every crosshair shape and animation draws
        for (int i = 0; i < style.options.length; i++) {
            style.set(i);
            for (int a = 0; a < anim.options.length; a++) {
                anim.set(a);
                Java2DGfx g = new Java2DGfx(640, 360, 2);
                fakeWorld(g);
                Hammer.renderHud(g);
                if (a == 0) g.save(new File(out, "21-crosshair-" + style.options[i] + ".png"));
            }
        }
        for (Module m : Modules.ALL) m.data().enabled = null;
        crosshair.resetSettings();

        // Hammer+ that has run out behaves like none
        cfg.plusUntil = System.currentTimeMillis() / 1000 - 5;
        assertTrue(!Hammer.plus());
        assertEquals("classic", cfg.hudStyleInUse());
        cfg.plusActive = false;
        cfg.plusUntil = 0;
        cfg.cape = "";
        cfg.hudStyle = "classic";
        cfg.menuBackground = "default";
        assertEquals(0, Hammer.problemCount());
    }
}
