package pl.hammershop.client;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.api.Gfx;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.core.Benchmark;
import pl.hammershop.client.core.Capes;
import pl.hammershop.client.core.Config;
import pl.hammershop.client.core.Fmt;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.core.Log;
import pl.hammershop.client.core.Stats;
import pl.hammershop.client.core.Waypoints;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudLayout;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Modules;
import pl.hammershop.client.screens.MainMenuScreen;
import pl.hammershop.client.screens.ModMenuScreen;
import pl.hammershop.client.screens.PauseOverlay;
import pl.hammershop.client.screens.WaypointsScreen;
import pl.hammershop.client.screens.WelcomeHint;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Input;
import pl.hammershop.client.ui.Ui;
import pl.hammershop.client.ui.UiScreen;

import java.io.InputStream;
import java.util.Properties;

/**
 * Hammer Client – the heart shared by every Minecraft version. The per-version platform code calls in here
 * (init, tick, render, input, a few hooks) and everything else – modules, HUD, menus – is version independent.
 */
public final class Hammer {
    private static Platform platform;
    private static Config config;
    private static final Input INPUT = new Input();
    private static final Stats STATS = new Stats();
    private static String version = "dev";
    private static int ticks;
    private static boolean wasInWorld;
    private static boolean announcedMenu;

    private Hammer() {
    }

    public static void init(Platform p) {
        platform = p;
        try (InputStream in = Hammer.class.getResourceAsStream("/hammerclient.properties")) {
            if (in != null) {
                Properties props = new Properties();
                props.load(in);
                version = props.getProperty("version", version);
            }
        } catch (Exception ignored) {
            // keep "dev"
        }
        config = Config.load(p.configDir());
        Lang.load(p.language());
        Fmt.comma = p.language() != null && p.language().toLowerCase().startsWith("pl");
        Waypoints.load(p.configDir());
        Modules.init(p);
        Modules.apply(true);
        Log.info("Gotowe – wersja " + version + " dla Minecrafta " + p.minecraftVersion() + ", " + Modules.ALL.size() + " modułów, panel: " + p.keyName(Keys.MENU.id));
    }

    public static Platform platform() {
        return platform;
    }

    public static Game game() {
        return platform.game();
    }

    public static Config config() {
        return config;
    }

    public static Input input() {
        return INPUT;
    }

    public static Stats stats() {
        return STATS;
    }

    public static String version() {
        return version;
    }

    /** Hammer+ is active (the launcher verified the player's code; it may run out while the game is open). */
    public static boolean plus() {
        return config != null && config.plusActive && (config.plusUntil == 0 || config.plusUntil * 1000L > System.currentTimeMillis());
    }

    public static boolean animations() {
        return config == null || config.animations;
    }

    public static String t(String key, Object... args) {
        return Lang.t(key, args);
    }

    // ───────────── game loop ─────────────

    /** 20 times per second. */
    public static void tick() {
        if (platform == null) return;
        try {
            tickNow();
        } catch (RuntimeException e) {
            problem("Błąd w obsłudze modułów", e);
        }
    }

    private static void tickNow() {
        Game g = platform.game();
        boolean inWorld = g.inWorld();
        if (wasInWorld && !inWorld) STATS.leftWorld();
        wasInWorld = inWorld;
        Lang.load(platform.language());
        STATS.tick(platform);
        Capes.tick();
        if (platform.keyPressed(Keys.WAYPOINTS.id) && inWorld && platform.inGameFocus() && Modules.waypoints != null && Modules.waypoints.enabled()) open(new WaypointsScreen());
        if (platform.keyPressed(Keys.MENU.id) && inWorld && platform.inGameFocus()) open(new ModMenuScreen());
        if (platform.keyPressed(Keys.HUD.id)) {
            config.hudVisible = !config.hudVisible;
            config.markDirty();
        }
        if (platform.keyPressed(Keys.STOPWATCH.id)) STATS.stopwatchPress();
        Modules.tick();
        if (++ticks % 100 == 0) {
            config.saveIfDirty();
            Waypoints.save();
        }
    }

    /** Draws the HUD modules (and the custom crosshair) over the game. A failure never reaches the game. */
    public static void renderHud(Gfx g) {
        if (platform == null || !platform.game().inWorld()) return;
        Draw d = new Draw(g);
        try {
            STATS.frame(platform);
            WelcomeHint.render(d);
            if (config.hudVisible) {
                if (Modules.waypoints != null && Modules.waypoints.enabled()) Waypoints.render(d, platform.game());
                if (Modules.crosshair != null && Modules.crosshair.enabled() && !(Modules.crosshair.hiddenInThirdPerson() && platform.cameraMode() != 0)) {
                    Modules.crosshair.render(d, g.width() / 2f, g.height() / 2f);
                }
                drawHud(d, false);
            }
            Benchmark.frame(d, platform); // on top of the HUD, and also when the HUD is hidden
        } catch (RuntimeException e) {
            d.unwind();
            problem("HUD nie narysował się", e);
        }
    }

    private static long lastProblem;
    private static int problems;

    /** How many failures of ours were caught so far (the tests expect none). */
    public static int problemCount() {
        return problems;
    }

    /** Logs a failure of ours at most once every ten seconds (a broken frame would repeat it 60 times a second). */
    private static void problem(String what, Throwable e) {
        problems++;
        long now = System.currentTimeMillis();
        if (now - lastProblem < 10_000) return;
        lastProblem = now;
        Log.warn(what, e);
    }

    /** All enabled HUD modules at their places; the editor draws them too, with sample content. */
    public static void drawHud(Draw d, boolean editor) {
        boolean smooth = "hammer".equals(config.hudFont);
        Game game = platform.game();
        float sw = d.g.width() / d.scale();
        float sh = d.g.height() / d.scale();
        // The game draws its own effect icons in the top-right corner (helpful ones in the first row, harmful below).
        float effects = 0;
        for (Game.Effect e : game.effects()) effects = Math.max(effects, e.beneficial() ? 27 : 53);
        HudLayout.arrange(Modules.HUD, sw, sh, effects, editor);
        for (HudModule m : Modules.HUD) {
            if (!m.enabled()) continue;
            int[] mark = d.mark();
            d.push();
            d.translate(m.left(sw), m.top(sh));
            d.scale(m.size());
            try {
                m.render(new HudCanvas(d, game, platform, editor, smooth));
                d.pop();
            } catch (RuntimeException e) {
                // One broken module must never take the whole HUD (or the game) down.
                d.rewind(mark);
                m.w = 0;
                m.h = 0;
                problem("Moduł " + m.id + " nie narysował się", e);
            }
        }
    }

    /** Draws one of our screens for this frame (mouse in GUI pixels). False = it failed and should be closed. */
    public static boolean renderScreen(UiScreen screen, Gfx g, float mouseX, float mouseY) {
        Ui ui = new Ui(g, screen.state, INPUT, mouseX, mouseY);
        try {
            screen.render(ui);
            ui.end();
            return true;
        } catch (RuntimeException e) {
            ui.d.unwind();
            problems++;
            Log.warn("Ekran " + screen.getClass().getSimpleName() + " nie narysował się – zamykam go", e);
            return false;
        }
    }

    // ───────────── screens ─────────────

    public static void open(UiScreen screen) {
        INPUT.reset();
        platform.show(screen);
    }

    /** Leaves a screen: to its parent, or back to the game / main menu. */
    public static void back(UiScreen screen) {
        config.saveIfDirty();
        Waypoints.save();
        INPUT.reset();
        platform.show(screen.parent);
    }

    /** Esc on one of our screens; closes popups first. */
    public static void escape(UiScreen screen) {
        if (screen.state.focusOrPopupClosed()) return;
        if (screen.escape()) back(screen);
    }

    /** The screen that replaces the vanilla title screen, or null when the player turned that off. */
    public static UiScreen mainMenu() {
        if (config == null || !config.customMenu) return null;
        if (!announcedMenu) {
            announcedMenu = true;
            Log.info("Menu główne Hammer otwarte");
        }
        return new MainMenuScreen();
    }

    private static final PauseOverlay PAUSE = new PauseOverlay();

    /** Extra buttons drawn over the vanilla pause menu. */
    public static void renderPauseOverlay(Gfx g, float mouseX, float mouseY) {
        if (config == null || !config.pauseButtons || pauseBroken) return;
        try {
            PAUSE.render(g, mouseX, mouseY);
        } catch (RuntimeException e) {
            pauseBroken = true; // the vanilla pause menu stays as it is
            Log.warn("Przyciski Hammer w menu pauzy nie narysowały się – wyłączam je do końca gry", e);
        }
    }

    private static boolean pauseBroken;

    /** A click on the pause menu; true = one of our buttons took it. */
    public static boolean pauseClick(float mouseX, float mouseY) {
        return config != null && config.pauseButtons && !pauseBroken && PAUSE.click(mouseX, mouseY);
    }

    // ───────────── hooks called from the game (mixins) ─────────────

    public static double fov(double fov) {
        double out = Modules.zoom != null ? Modules.zoom.apply(fov) : fov;
        lastFov = out;
        return out;
    }

    public static boolean zoomScroll(double amount) {
        return Modules.zoom != null && Modules.zoom.scroll(amount);
    }

    public static void attacked(double distance, int entityId) {
        STATS.attacked(distance, entityId);
    }

    private static double lastFov = 70;

    /** The vertical field of view the world was last drawn with (zoom included) – waypoints are projected with it. */
    public static double lastFov() {
        return lastFov;
    }

    /** Cape of a player (UUID without dashes): the own Hammer+ cape, or another player's from the shop's server; null = none. */
    public static String cape(String uuid, boolean self) {
        return Capes.of(uuid, self);
    }

    public static boolean tabPing() {
        return Modules.tabPing != null && Modules.tabPing.enabled();
    }

    /** Draws a player's ping as a number in the tab list (x, y, width = the player's row, like the vanilla icon); false = it failed. */
    public static boolean renderTabPing(Gfx g, int x, int y, int width, int latency) {
        Draw d = new Draw(g);
        try {
            Modules.tabPing.render(g, x, y, width, latency);
            return true;
        } catch (RuntimeException e) {
            d.unwind();
            problem("Ping w Tab nie narysował się", e);
            return false;
        }
    }

    /** "[12:34] " to put in front of a chat message, or null. */
    public static String chatPrefix() {
        return Modules.chat != null && Modules.chat.enabled() ? Modules.chat.prefix() : null;
    }

    /** The time in front of a chat message can be clicked to copy the message. */
    public static boolean chatCopy() {
        return Modules.chat != null && Modules.chat.enabled() && Modules.chat.clickToCopy();
    }

    /** How many chat messages the game keeps (vanilla: 100). */
    public static int chatHistory(int vanilla) {
        return Modules.chat != null && Modules.chat.enabled() && Modules.chat.longHistory() ? 16384 : vanilla;
    }

    /** How far the fire on your screen is pushed down (0 = vanilla), in the game's overlay units. */
    public static float lowFire() {
        return Modules.overlays != null && Modules.overlays.enabled() ? Modules.overlays.fireOffset() : 0f;
    }

    public static boolean hidePumpkin() {
        return Modules.overlays != null && Modules.overlays.enabled() && Modules.overlays.noPumpkin();
    }

    public static boolean hideVignette() {
        return Modules.overlays != null && Modules.overlays.enabled() && Modules.overlays.noVignette();
    }

    public static void timePacket() {
        STATS.timePacket();
    }

    public static boolean hideVanillaCrosshair() {
        return config != null && config.hudVisible && Modules.crosshair != null && Modules.crosshair.enabled();
    }

    /** Client-side time of day, or `real` when the time changer is off. */
    public static long dayTime(long real) {
        return Modules.timeChanger != null && Modules.timeChanger.enabled() ? Modules.timeChanger.time() : real;
    }

    public static boolean clearWeather() {
        return Modules.weather != null && Modules.weather.enabled();
    }

    public static boolean freelook() {
        return Modules.freelook != null && Modules.freelook.active();
    }

    public static void freelookTurn(double dx, double dy) {
        if (Modules.freelook != null) Modules.freelook.turn(dx, dy);
    }

    public static float freelookYaw() {
        return Modules.freelook.yaw();
    }

    public static float freelookPitch() {
        return Modules.freelook.pitch();
    }

    public static void shutdown() {
        if (config != null) config.save();
        Waypoints.save();
    }
}
