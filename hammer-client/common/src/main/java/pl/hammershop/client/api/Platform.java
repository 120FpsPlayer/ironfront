package pl.hammershop.client.api;

import pl.hammershop.client.ui.UiScreen;

import java.nio.file.Path;

/** What Hammer Client needs from the game, implemented once per Minecraft version. */
public interface Platform {
    String minecraftVersion();

    Path configDir();

    /** Game language code, e.g. "pl_pl". */
    String language();

    Game game();

    /** Opens one of our screens (null closes the current screen). */
    void show(UiScreen screen);

    /** Opens a vanilla screen; it returns to `back` (or the main menu) when closed. */
    void showVanilla(Vanilla which, UiScreen back);

    void quit();

    void openUrl(String url);

    void clickSound();

    String clipboard();

    void setClipboard(String text);

    /** Key bindings registered for {@link Keys}: held right now / pressed since the last call / display name. */
    boolean keyHeld(String id);

    boolean keyPressed(String id);

    String keyName(String id);

    /** Raw key state by GLFW key code (for the keystrokes HUD use {@link #moveKey}). */
    boolean moveKey(Move key);

    String moveKeyName(Move key);

    /** Left = 0, right = 1. */
    boolean mouseHeld(int button);

    // Vanilla options our modules switch.
    boolean toggleSprint();

    void setToggleSprint(boolean on);

    boolean toggleSneak();

    void setToggleSneak(boolean on);

    /** 0–1, vanilla "Damage Tilt". */
    double damageTilt();

    void setDamageTilt(double value);

    /** 0–1, vanilla "FOV Effects". */
    double fovEffects();

    void setFovEffects(double value);

    /** Brightness without the vanilla 0–1 limit (fullbright). */
    double gamma();

    void setGamma(double value);

    boolean smoothCamera();

    void setSmoothCamera(boolean on);

    /** Camera view: 0 = first person, 1 = third person (behind), 2 = third person (front). */
    int cameraMode();

    void setCameraMode(int mode);

    /** No screen is open and the mouse controls the player. */
    boolean inGameFocus();

    /** True when the entity with this id (from the attack hook) is dying or dead; false when alive or unknown. */
    boolean entityDead(int entityId);

    /** Turns the player by this many degrees (the FPS test pans the camera in singleplayer). */
    void turnPlayer(float yawDelta);

    /**
     * Loads a PNG from disk as the texture `name` (usable with {@link Gfx#image}); returns {width, height}, or null
     * when the file is missing, too big or not a picture. Call it from the render thread.
     */
    int[] loadImage(String name, Path file);

    /** Features that need hooks a game version may lack; modules for unsupported ones are hidden. */
    default boolean supports(Feature feature) {
        return true;
    }

    enum Feature {
        ZOOM, FREELOOK, CROSSHAIR, TIME_CHANGER, WEATHER, COMBO, TPS, FULLBRIGHT, WAYPOINTS, CHAT, TAB_PING, OVERLAYS, CAPES
    }

    enum Vanilla {
        SINGLEPLAYER, MULTIPLAYER, OPTIONS, CONTROLS
    }

    enum Move {
        FORWARD, BACK, LEFT, RIGHT, JUMP, SNEAK, SPRINT, ATTACK, USE
    }
}
