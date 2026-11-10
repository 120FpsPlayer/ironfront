package pl.hammershop.client.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * config/hammerclient.json – what the player chose: profiles (each with its modules, HUD layout and settings),
 * accent colour, menus. The launcher writes its own file, config/hammerclient-launcher.json (Discord invite, shop
 * link, brand), which is only read here, so the launcher never overwrites the player's layout.
 */
public final class Config {
    public static final class ModuleData {
        public Boolean enabled;
        /** Position as a share of the free space (0 = left / top, 1 = right / bottom); -1 = the module's default. */
        public float x = -1f;
        public float y = -1f;
        public Map<String, Object> values = new LinkedHashMap<>();
    }

    public static final class Profile {
        public String name = "";
        public Map<String, ModuleData> modules = new LinkedHashMap<>();
    }

    public int version = 2;
    public boolean customMenu = true;
    public boolean pauseButtons = true;
    public boolean animations = true;
    public boolean hudVisible = true;
    public boolean welcomed = false;
    public String accent = "orange";
    /** "minecraft" (pixel font) or "hammer" (smooth). */
    public String hudFont = "minecraft";
    public String profile = "default";
    public Map<String, Profile> profiles = new LinkedHashMap<>();

    // From the launcher – read on start, never saved here.
    public transient String discordUrl = "";
    public transient String shopUrl = "";
    public transient String brand = "HammerShop";
    private transient Path dir;
    private transient boolean dirty;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public static Config load(Path dir) {
        Config c = null;
        Path file = dir.resolve("hammerclient.json");
        try {
            if (Files.exists(file)) c = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), Config.class);
        } catch (Exception e) {
            Log.warn("Nie udało się wczytać ustawień – używam domyślnych", e);
        }
        if (c == null) c = new Config();
        c.dir = dir;
        if (c.profiles == null) c.profiles = new LinkedHashMap<>();
        if (c.accent == null) c.accent = "orange";
        if (c.hudFont == null) c.hudFont = "minecraft";
        if (c.profile == null || !c.profiles.containsKey(c.profile)) {
            if (c.profiles.isEmpty()) {
                Profile p = new Profile();
                p.name = "Domyślny";
                c.profiles.put("default", p);
            }
            c.profile = c.profiles.keySet().iterator().next();
        }
        for (Profile p : c.profiles.values()) {
            if (p.modules == null) p.modules = new LinkedHashMap<>();
            for (ModuleData m : p.modules.values()) if (m.values == null) m.values = new LinkedHashMap<>();
        }
        c.readLauncher();
        return c;
    }

    private void readLauncher() {
        Path file = dir.resolve("hammerclient-launcher.json");
        if (!Files.exists(file)) return;
        try {
            JsonObject o = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), JsonObject.class);
            discordUrl = httpsOrEmpty(o.get("discordUrl"));
            shopUrl = httpsOrEmpty(o.get("shopUrl"));
            JsonElement b = o.get("brand");
            if (b != null && b.isJsonPrimitive() && !b.getAsString().isBlank()) brand = b.getAsString().trim();
        } catch (Exception e) {
            Log.warn("Nieprawidłowy plik od launchera", e);
        }
    }

    private static String httpsOrEmpty(JsonElement e) {
        if (e == null || !e.isJsonPrimitive()) return "";
        String s = e.getAsString().trim();
        return s.startsWith("https://") ? s : "";
    }

    public Profile active() {
        return profiles.get(profile);
    }

    public ModuleData module(String id) {
        return active().modules.computeIfAbsent(id, k -> new ModuleData());
    }

    /** Creates a profile (a copy of the active one, or empty) and returns its key. */
    public String addProfile(String name, boolean copy) {
        String key = "p" + Long.toString(System.currentTimeMillis(), 36);
        Profile p = copy ? GSON.fromJson(GSON.toJson(active()), Profile.class) : new Profile();
        p.name = name;
        profiles.put(key, p);
        markDirty();
        return key;
    }

    public void removeProfile(String key) {
        if (profiles.size() <= 1 || !profiles.containsKey(key)) return;
        profiles.remove(key);
        if (key.equals(profile)) profile = profiles.keySet().iterator().next();
        markDirty();
    }

    public void markDirty() {
        dirty = true;
    }

    public void saveIfDirty() {
        if (dirty) save();
    }

    public void save() {
        dirty = false;
        if (dir == null) return;
        try {
            Files.createDirectories(dir);
            Files.writeString(dir.resolve("hammerclient.json"), GSON.toJson(this), StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.warn("Nie udało się zapisać ustawień", e);
        }
    }
}
