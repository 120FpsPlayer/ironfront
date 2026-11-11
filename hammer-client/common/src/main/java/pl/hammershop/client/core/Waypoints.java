package pl.hammershop.client.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Game;
import pl.hammershop.client.module.Modules;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Waypoints: places the player marked, kept per server / singleplayer world in config/hammerclient/waypoints.json
 * and drawn on the HUD where they are in the world (a marker with the name and the distance). Only the player sees
 * them – nothing is sent anywhere.
 */
public final class Waypoints {
    public static final class Point {
        public String name = "";
        public int x;
        public int y;
        public int z;
        /** "minecraft:overworld" … */
        public String dim = "";
        public int color = 0xFFFF9F43;
        public boolean visible = true;
        /** The automatic "you died here" point (only the newest one is kept). */
        public boolean death;
    }

    /** At most this many per world, so the list and the file stay small. */
    public static final int LIMIT = 100;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static Map<String, List<Point>> all = new LinkedHashMap<>();
    private static Path file;
    private static boolean dirty;

    private Waypoints() {
    }

    public static void load(Path configDir) {
        all = new LinkedHashMap<>();
        dirty = false;
        file = configDir.resolve("hammerclient").resolve("waypoints.json");
        try {
            if (!Files.exists(file)) return;
            Map<String, List<Point>> read = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), new TypeToken<Map<String, List<Point>>>() {
            }.getType());
            if (read == null) return;
            for (Map.Entry<String, List<Point>> e : read.entrySet()) {
                List<Point> list = new ArrayList<>();
                if (e.getValue() != null) {
                    for (Point p : e.getValue()) {
                        if (p == null || list.size() >= LIMIT) continue;
                        if (p.name == null) p.name = "";
                        if (p.dim == null) p.dim = "";
                        list.add(p);
                    }
                }
                if (e.getKey() != null && !list.isEmpty()) all.put(e.getKey(), list);
            }
        } catch (Exception e) {
            Log.warn("Nie udało się wczytać waypointów – zaczynam od pustej listy", e);
        }
    }

    public static void save() {
        if (!dirty || file == null) return;
        dirty = false;
        try {
            Files.createDirectories(file.getParent());
            Path tmp = file.resolveSibling("waypoints.json.tmp");
            Files.writeString(tmp, GSON.toJson(all), StandardCharsets.UTF_8);
            Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            Log.warn("Nie udało się zapisać waypointów", e);
        }
    }

    /** The points of a world (never null; do not modify – use {@link #add} / {@link #remove}). */
    public static List<Point> of(String worldKey) {
        List<Point> list = all.get(worldKey);
        return list != null ? list : List.of();
    }

    /** Adds a point; false when the world already has {@link #LIMIT} of them or there is no world. */
    public static boolean add(String worldKey, Point p) {
        if (worldKey == null || worldKey.isEmpty()) return false;
        List<Point> list = all.computeIfAbsent(worldKey, k -> new ArrayList<>());
        if (list.size() >= LIMIT) return false;
        list.add(p);
        dirty = true;
        return true;
    }

    public static void remove(String worldKey, Point p) {
        List<Point> list = all.get(worldKey);
        if (list != null && list.remove(p)) {
            if (list.isEmpty()) all.remove(worldKey);
            dirty = true;
        }
    }

    public static void changed() {
        dirty = true;
    }

    /** A point at the player's feet. */
    public static Point here(Game g, String name, int color) {
        Point p = new Point();
        p.name = name;
        p.x = (int) Math.floor(g.x());
        p.y = (int) Math.floor(g.y());
        p.z = (int) Math.floor(g.z());
        p.dim = g.dimension();
        p.color = color;
        return p;
    }

    /** The player died: remember where (replacing the previous death point of this world). */
    public static void died(Game g) {
        if (Modules.waypoints == null || !Modules.waypoints.enabled() || !Modules.waypoints.deathPoint()) return;
        String key = g.worldKey();
        if (key.isEmpty()) return;
        List<Point> list = all.get(key);
        if (list != null && list.removeIf(p -> p.death)) dirty = true;
        Point p = here(g, Lang.t("waypoint.death"), 0xFFFF6B6B);
        p.death = true;
        add(key, p);
    }

    /** Human name of a dimension id. */
    public static String dimensionName(String dim) {
        return switch (dim) {
            case "minecraft:overworld" -> Lang.t("dim.overworld");
            case "minecraft:the_nether" -> Lang.t("dim.nether");
            case "minecraft:the_end" -> Lang.t("dim.end");
            default -> dim.contains(":") ? dim.substring(dim.indexOf(':') + 1) : dim;
        };
    }

    public static double distance(Game g, Point p) {
        double dx = p.x + 0.5 - g.x();
        double dy = p.y - g.y();
        double dz = p.z + 0.5 - g.z();
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    public static String distanceText(double blocks) {
        return blocks >= 10000 ? Fmt.num(blocks / 1000.0, 1) + " km" : Math.round(blocks) + " m";
    }

    /**
     * Where a world position lands on a screen of w × h: {x, y} or null when it is behind the camera. `fov` is the
     * vertical field of view in degrees; yaw / pitch are Minecraft's (yaw 0 = south, positive pitch = down).
     */
    public static float[] project(double px, double py, double pz, double camX, double camY, double camZ, float yawDeg, float pitchDeg, double fov, float w, float h) {
        double yaw = Math.toRadians(yawDeg);
        double pitch = Math.toRadians(pitchDeg);
        double sy = Math.sin(yaw);
        double cy = Math.cos(yaw);
        double sp = Math.sin(pitch);
        double cp = Math.cos(pitch);
        double vx = px - camX;
        double vy = py - camY;
        double vz = pz - camZ;
        double depth = vx * -sy * cp + vy * -sp + vz * cy * cp;      // along the view direction
        if (depth < 0.05) return null;
        double right = vx * -cy + vz * -sy;
        double up = vx * -sy * sp + vy * cp + vz * cy * sp;
        double tan = Math.tan(Math.toRadians(Math.max(1, Math.min(170, fov))) / 2.0);
        double aspect = w / Math.max(1f, h);
        return new float[] {(float) (w / 2.0 + right / depth / (tan * aspect) * (w / 2.0)), (float) (h / 2.0 - up / depth / tan * (h / 2.0))};
    }

    /** Draws the markers of this world and dimension (HUD pass, GUI pixels). */
    public static void render(Draw d, Game g) {
        List<Point> list = of(g.worldKey());
        if (list.isEmpty()) return;
        String dim = g.dimension();
        float w = d.g.width();
        float h = d.g.height();
        float scale = Modules.waypoints.markerScale();
        boolean showDistance = Modules.waypoints.showDistance();
        double fov = Hammer.lastFov();
        for (Point p : list) {
            if (!p.visible || !p.dim.equals(dim)) continue;
            float[] s = project(p.x + 0.5, p.y + 1.2, p.z + 0.5, g.cameraX(), g.cameraY(), g.cameraZ(), g.cameraYaw(), g.cameraPitch(), fov, w, h);
            if (s == null || s[0] < -40 || s[0] > w + 40 || s[1] < -20 || s[1] > h + 20) continue;
            // Points near the crosshair are fully visible, the others are fainter so they do not cover the view.
            float off = (float) Math.hypot(s[0] - w / 2f, s[1] - h / 2f) / Math.max(1f, h / 2f);
            float a = Math.max(0.5f, 1f - off * 0.6f);
            int color = p.color | 0xFF000000;
            d.push();
            d.translate(s[0], s[1]);
            d.scale(scale);
            d.circle(0, 0, 4.2f, Draw.alpha(0xFF000000, 0.55f * a));
            d.circle(0, 0, 3.2f, Draw.alpha(color, a));
            d.circle(0, 0, 1.2f, Draw.alpha(0xFFFFFFFF, 0.9f * a));
            String label = p.name.isEmpty() ? distanceText(distance(g, p)) : showDistance ? p.name + "  " + distanceText(distance(g, p)) : p.name;
            float tw = d.textWidth(label, 6.5f, Font.BOLD);
            d.rrect(-tw / 2f - 4, 6.5f, tw + 8, 11, 3.5f, Draw.alpha(0xFF0E0B09, 0.62f * a));
            d.textCentered(label, 0, 8.4f, 6.5f, Draw.alpha(0xFFFFFFFF, a), Font.BOLD);
            d.pop();
        }
    }
}
