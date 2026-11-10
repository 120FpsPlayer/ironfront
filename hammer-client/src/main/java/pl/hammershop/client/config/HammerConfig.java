package pl.hammershop.client.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.fabricmc.loader.api.FabricLoader;
import pl.hammershop.client.HammerClient;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * config/hammerclient.json – the player's choices (modules, HUD layout, scale). The launcher writes its own file,
 * config/hammerclient-launcher.json (Discord invite, shop link, brand), so it never overwrites the player's layout.
 */
public final class HammerConfig {
    public static final class ModuleState {
        public boolean enabled;
        /** Position as a share of the free space (0 = left/top, 1 = right/bottom); -1 = the module's default. */
        public float x = -1f;
        public float y = -1f;
    }

    public boolean customMenu = true;
    public float hudScale = 1.0f;
    public float zoomFactor = 0.25f;
    public boolean smoothZoom = true;
    public Map<String, ModuleState> modules = new LinkedHashMap<>();

    // From the launcher – read on start, never saved here.
    public transient String discordUrl = "";
    public transient String shopUrl = "";
    public transient String brand = "HammerShop";

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private static Path dir() {
        return FabricLoader.getInstance().getConfigDir();
    }

    public static HammerConfig load() {
        HammerConfig c = null;
        Path file = dir().resolve("hammerclient.json");
        try {
            if (Files.exists(file)) c = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), HammerConfig.class);
        } catch (Exception e) {
            HammerClient.LOG.warn("[Hammer Client] Nie udało się wczytać ustawień – używam domyślnych", e);
        }
        if (c == null) c = new HammerConfig();
        if (c.modules == null) c.modules = new LinkedHashMap<>();
        c.hudScale = clamp(c.hudScale, 0.5f, 2.0f);
        c.zoomFactor = clamp(c.zoomFactor, 0.1f, 0.8f);
        c.readLauncher();
        return c;
    }

    private void readLauncher() {
        Path file = dir().resolve("hammerclient-launcher.json");
        if (!Files.exists(file)) return;
        try {
            JsonObject o = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), JsonObject.class);
            discordUrl = httpsOrEmpty(o.get("discordUrl"));
            shopUrl = httpsOrEmpty(o.get("shopUrl"));
            JsonElement b = o.get("brand");
            if (b != null && b.isJsonPrimitive() && !b.getAsString().isBlank()) brand = b.getAsString().trim();
        } catch (Exception e) {
            HammerClient.LOG.warn("[Hammer Client] Nieprawidłowy plik od launchera", e);
        }
    }

    private static String httpsOrEmpty(JsonElement e) {
        if (e == null || !e.isJsonPrimitive()) return "";
        String s = e.getAsString().trim();
        return s.startsWith("https://") ? s : "";
    }

    public void save() {
        try {
            Files.createDirectories(dir());
            Files.writeString(dir().resolve("hammerclient.json"), GSON.toJson(this), StandardCharsets.UTF_8);
        } catch (Exception e) {
            HammerClient.LOG.warn("[Hammer Client] Nie udało się zapisać ustawień", e);
        }
    }

    public ModuleState module(String id, boolean defaultOn) {
        return modules.computeIfAbsent(id, k -> {
            ModuleState s = new ModuleState();
            s.enabled = defaultOn;
            return s;
        });
    }

    public static float clamp(float v, float min, float max) {
        return Float.isNaN(v) ? min : Math.max(min, Math.min(max, v));
    }
}
