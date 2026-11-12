package pl.hammershop.client.preview;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.ui.UiScreen;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** A pretend game for previews and tests. */
public final class FakePlatform implements Platform, Game {
    public final Path dir;
    public boolean inWorld = true;
    public UiScreen shown;
    public final List<String> opened = new ArrayList<>();
    public final Map<String, Object> options = new HashMap<>();
    public String language = "pl_pl";
    public int camera;

    public FakePlatform(Path dir) {
        this.dir = dir;
    }

    public String minecraftVersion() { return "26.3"; }
    public Path configDir() { return dir; }
    public String language() { return language; }
    public Game game() { return this; }
    public void show(UiScreen screen) { shown = screen; }
    public void showVanilla(Vanilla which, UiScreen back) { opened.add("vanilla:" + which); }
    public void quit() { opened.add("quit"); }
    public void openUrl(String url) { opened.add(url); }
    public void clickSound() { }
    public String clipboard() { return "schowek"; }
    public void setClipboard(String text) { }
    public boolean keyHeld(String id) { return false; }
    public boolean keyPressed(String id) { return false; }
    public String keyName(String id) { return switch (id) { case "menu" -> "Prawy Shift"; case "zoom" -> "C"; case "freelook" -> "Lewy Alt"; case "waypoints" -> "B"; default -> "—"; }; }
    public boolean moveKey(Move key) { return key == Move.FORWARD || key == Move.ATTACK; }
    public String moveKeyName(Move key) { return switch (key) { case FORWARD -> "W"; case BACK -> "S"; case LEFT -> "A"; case RIGHT -> "D"; default -> "?"; }; }
    public boolean mouseHeld(int button) { return false; }
    public boolean toggleSprint() { return Boolean.TRUE.equals(options.get("sprint")); }
    public void setToggleSprint(boolean on) { options.put("sprint", on); }
    public boolean toggleSneak() { return Boolean.TRUE.equals(options.get("sneak")); }
    public void setToggleSneak(boolean on) { options.put("sneak", on); }
    public double damageTilt() { return (double) options.getOrDefault("tilt", 1.0); }
    public void setDamageTilt(double value) { options.put("tilt", value); }
    public double fovEffects() { return (double) options.getOrDefault("fov", 1.0); }
    public void setFovEffects(double value) { options.put("fov", value); }
    public double gamma() { return (double) options.getOrDefault("gamma", 0.5); }
    public void setGamma(double value) { options.put("gamma", value); }
    public boolean smoothCamera() { return false; }
    public void setSmoothCamera(boolean on) { }
    public int cameraMode() { return camera; }
    public void setCameraMode(int mode) { camera = mode; }
    public boolean inGameFocus() { return shown == null; }
    public boolean entityDead(int entityId) { return dead.contains(entityId); }
    public void turnPlayer(float yawDelta) { turned += yawDelta; }
    public int[] loadImage(String name, Path file) { return null; }
    public final java.util.Set<Integer> dead = new java.util.HashSet<>();
    public float turned;
    public float health = 18;
    public String worldKey = "mc.hammershop.pl";

    // Game
    public boolean inWorld() { return inWorld; }
    public int fps() { return 240; }
    public String playerName() { return "HammerGracz"; }
    public double x() { return 128.5; }
    public double y() { return 71; }
    public double z() { return -342.3; }
    public float yaw() { return 205f; }
    public float pitch() { return 10f; }
    public String biome() { return "Równiny"; }
    public int ping() { return 23; }
    public String server() { return "mc.hammershop.pl"; }
    public long dayTime() { return 24000L * 41 + 6000; }
    public float health() { return health; }
    public float maxHealth() { return 20; }
    public int food() { return 17; }
    public float saturation() { return 5.2f; }
    public int hurtTime() { return 0; }
    public boolean sprinting() { return true; }
    public boolean sneaking() { return false; }
    public int light() { return 12; }
    public List<Effect> effects() { return List.of(new Effect("Szybkość", 1, 1820, false, 0x33EBFF, true), new Effect("Odporność na ogień", 0, 150, false, 0xFF9900, true)); }
    public List<Item> equipment() {
        return List.of(new Item("helmet", "minecraft:diamond_helmet", "Diamentowy hełm", 1, 40, 363), new Item("chest", "minecraft:diamond_chestplate", "Diamentowy napierśnik", 1, 300, 528),
                new Item("legs", "minecraft:diamond_leggings", "Diamentowe nogawice", 1, 90, 495), new Item("boots", "minecraft:diamond_boots", "Diamentowe buty", 1, 400, 429),
                new Item("sword", "minecraft:diamond_sword", "Diamentowy miecz", 1, 120, 1561), new Item("totem", "minecraft:totem_of_undying", "Totem", 1, 0, 0));
    }
    public List<Item> inventory() {
        List<Item> inv = new ArrayList<>();
        for (int i = 0; i < 36; i++) inv.add(i % 4 == 0 ? new Item("item" + i, i == 12 ? "minecraft:arrow" : i == 16 ? "minecraft:golden_apple" : "minecraft:stone", "Przedmiot", 1 + i * 3 % 64, 0, 0) : Item.EMPTY);
        return inv;
    }
    public int armor() { return 12; }
    public float absorption() { return 0; }
    public Target target() { return new Target("Steve", 13f, 20f, 2.7, true); }
    public String block() { return "Ruda diamentu"; }
    public double cameraX() { return x(); }
    public double cameraY() { return y() + 1.62; }
    public double cameraZ() { return z(); }
    public float cameraYaw() { return yaw(); }
    public float cameraPitch() { return pitch(); }
    public String dimension() { return "minecraft:overworld"; }
    public String worldKey() { return worldKey; }
    public boolean singleplayer() { return false; }
    public String playerUuid() { return "0123456789ab4def8123456789abcdef"; }
    public int xpLevel() { return 30; }
    public float xpProgress() { return 0.45f; }
    public int air = 300;
    public int air() { return air; }
    public int maxAir() { return 300; }
    public int weather() { return 1; }
    public List<String> online = new ArrayList<>(List.of("0123456789ab4def8123456789abcdef", "11111111111141118111111111111111", "22222222222242228222222222222222"));
    public List<String> onlinePlayers() { return online; }
    public float attackCharge = 1f;
    public float attackCharge() { return attackCharge; }
}
