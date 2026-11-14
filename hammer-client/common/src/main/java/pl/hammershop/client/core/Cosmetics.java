package pl.hammershop.client.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import pl.hammershop.client.Hammer;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Dodatki (Hammer+): wings, a halo and hats Hammer Client draws on players, and the moving capes. What they look like
 * comes from assets/hammerclient/cosmetics.json (written by tools/gen_cosmetics.py together with the textures): boxes
 * on the head or the body, built exactly like Minecraft builds its own models. They are turned into ready quads once;
 * the game version only moves them with the player's bones and draws them. Your own come from the launcher (only
 * while Hammer+ is active), other players' from the shop's server together with their capes ({@link Capes}).
 */
public final class Cosmetics {
    public static final String WINGS = "wings";
    public static final String HALO = "halo";
    public static final String HAT = "hat";

    /** What a player wears: a cape (null = none), wings and a hat (ids, null = none) and the halo. */
    public record Look(String cape, String wings, boolean halo, String hat) {
        public static final Look NONE = new Look(null, null, false, null);

        /** No wings, halo or hat (a cape may still be there). */
        public boolean bare() {
            return wings == null && !halo && hat == null;
        }
    }

    public enum Bone { HEAD, BODY }

    public enum Anim { NONE, FLAP_LEFT, FLAP_RIGHT, BOB }

    /** One piece on a bone: quads in its own space, hung at the pivot (block units) and moved by its animation. */
    public static final class Part {
        public final Bone bone;
        public final float px;
        public final float py;
        public final float pz;
        public final Anim anim;
        /** Per vertex: x, y, z (blocks), u, v (0–1), normal x, y, z – four vertices per quad. */
        public final float[] quads;

        Part(Bone bone, float px, float py, float pz, Anim anim, float[] quads) {
            this.bone = bone;
            this.px = px;
            this.py = py;
            this.pz = pz;
            this.anim = anim;
            this.quads = quads;
        }

        public int vertices() {
            return quads.length / STRIDE;
        }
    }

    /** One cosmetic: its slot (wings / halo / hat), its texture (hammerclient:textures/cosmetics/&lt;id&gt;.png) and parts. */
    public static final class Item {
        public final String id;
        public final String slot;
        /** Drawn at full brightness and see-through where the texture is (the halo's glow). */
        public final boolean glow;
        public final List<Part> parts;

        /** The highest and the lowest point (blocks on its bone, y grows downwards). */
        public final float top;
        public final float bottom;

        Item(String id, String slot, boolean glow, List<Part> parts) {
            this.id = id;
            this.slot = slot;
            this.glow = glow;
            this.parts = parts;
            float t = Float.MAX_VALUE;
            float b = -Float.MAX_VALUE;
            for (Part p : parts) {
                for (int i = 1; i < p.quads.length; i += STRIDE) {
                    t = Math.min(t, p.py + p.quads[i]);
                    b = Math.max(b, p.py + p.quads[i]);
                }
            }
            top = parts.isEmpty() ? 0 : t;
            bottom = parts.isEmpty() ? 0 : b;
        }

        public String texture() {
            return "textures/cosmetics/" + id + ".png";
        }
    }

    /** A moving cape: its texture is a strip of `frames` cape pictures, one under the other, shown `fps` per second. */
    public record MovingCape(String id, int frames, int fps, String fallback) {
        /** The frame to show at this moment (the same for everybody, so all players' capes move together). */
        public int frameAt(long millis) {
            return (int) ((millis * fps / 1000) % frames);
        }
    }

    public static final int STRIDE = 8;
    private static final String FILE = "/assets/hammerclient/cosmetics.json";

    private static volatile Catalog catalog;

    private record Catalog(Map<String, Item> items, Map<String, MovingCape> capes) {
    }

    private Cosmetics() {
    }

    private static Catalog catalog() {
        Catalog c = catalog;
        if (c == null) {
            synchronized (Cosmetics.class) {
                if (catalog == null) catalog = load();
                c = catalog;
            }
        }
        return c;
    }

    private static Catalog load() {
        try (InputStream in = Cosmetics.class.getResourceAsStream(FILE)) {
            if (in == null) throw new IllegalStateException("brak " + FILE);
            return parse(JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject());
        } catch (Exception e) {
            Log.warn("Nie udało się wczytać dodatków (cosmetics.json)", e);
            return new Catalog(Map.of(), Map.of());
        }
    }

    /** The cosmetic with this id, or null. */
    public static Item item(String id) {
        return id == null ? null : catalog().items.get(id);
    }

    /** Every cosmetic, in the order of the file. */
    public static List<Item> items() {
        return List.copyOf(catalog().items.values());
    }

    /** The moving cape with this id, or null (a still cape, or unknown). */
    public static MovingCape movingCape(String id) {
        return id == null ? null : catalog().capes.get(id);
    }

    /** An id of a cosmetic of this slot – anything else is null. */
    public static String valid(String slot, String id) {
        Item item = item(id);
        return item != null && item.slot.equals(slot) ? id : null;
    }

    /** Your own cosmetics (from the launcher): only while Hammer+ is active. The cape is left to {@link Capes#own}. */
    public static Look own(Config c) {
        if (c == null || !Hammer.plus()) return Look.NONE;
        return new Look(null, valid(WINGS, c.wings), c.halo && item(HALO) != null, valid(HAT, c.hat));
    }

    /** What the shop's server says one player wears: {"cape":…, "wings":…, "halo":true, "hat":…} – unknown ids are dropped. */
    public static Look parseLook(JsonElement e) {
        if (e == null || !e.isJsonObject()) return Look.NONE;
        JsonObject o = e.getAsJsonObject();
        String cape = text(o, "cape");
        return new Look(cape != null && Capes.known(cape) ? cape : null, valid(WINGS, text(o, "wings")), o.get(HALO) instanceof JsonElement h && h.isJsonPrimitive() && h.getAsJsonPrimitive().isBoolean() && h.getAsBoolean() && item(HALO) != null,
                valid(HAT, text(o, "hat")));
    }

    private static String text(JsonObject o, String key) {
        JsonElement v = o.get(key);
        return v != null && v.isJsonPrimitive() && v.getAsJsonPrimitive().isString() ? v.getAsString() : null;
    }

    /** How far the halo goes up (blocks, negative = up) to float a pixel and a half above this hat; 0 = it is high enough. */
    public static float haloLift(Item hat) {
        Item halo = item(HALO);
        if (hat == null || halo == null) return 0;
        return Math.min(0, hat.top - 1.5f / 16 - halo.bottom);
    }

    // ───────────── animation ─────────────

    /**
     * Moves a part for this moment: out = {dx, dy, dz (blocks, on top of the pivot), rx, ry, rz (radians, applied z,
     * then y, then x)}. ticks: the player's age in ticks (with the partial tick, so it is smooth and every player has
     * their own rhythm); flight: 0 = on the ground, 1 = flying or falling – the wings open wide and beat fast.
     */
    public static void animate(Part p, float ticks, float flight, float[] out) {
        out[0] = out[1] = out[2] = out[3] = out[4] = out[5] = 0;
        switch (p.anim) {
            case FLAP_LEFT, FLAP_RIGHT -> {
                float f = Math.max(0, Math.min(1, flight));
                // folded back a little and beating slowly – or wide open and beating fast
                double idle = Math.sin(ticks * 2 * Math.PI / 56);
                double fast = Math.sin(ticks * 2 * Math.PI / 9);
                double fold = lerp(24 + 5 * idle, 8 + 6 * fast, f);
                double beat = lerp(-8 + 5 * idle, -6 + 28 * fast, f);
                float sign = p.anim == Anim.FLAP_LEFT ? 1 : -1;
                out[4] = (float) Math.toRadians(-fold * sign);
                out[5] = (float) Math.toRadians(beat * sign);
            }
            case BOB -> out[1] = (float) (Math.sin(ticks * 2 * Math.PI / 64) * 0.7 / 16);
            default -> {
            }
        }
    }

    private static double lerp(double a, double b, float t) {
        return a + (b - a) * t;
    }

    // ───────────── cosmetics.json → quads ─────────────

    static Catalog parse(JsonObject root) {
        Map<String, MovingCape> capes = new LinkedHashMap<>();
        if (root.get("capes") instanceof JsonArray list) {
            for (JsonElement e : list) {
                JsonObject o = e.getAsJsonObject();
                String id = o.get("id").getAsString();
                int frames = o.get("frames").getAsInt();
                int fps = o.get("fps").getAsInt();
                if (frames >= 1 && frames <= 64 && fps >= 1 && fps <= 30) capes.put(id, new MovingCape(id, frames, fps, text(o, "fallback")));
            }
        }
        Map<String, Item> items = new LinkedHashMap<>();
        for (JsonElement e : root.getAsJsonArray("items")) {
            JsonObject o = e.getAsJsonObject();
            JsonArray size = o.getAsJsonArray("texture");
            float tw = size.get(0).getAsFloat();
            float th = size.get(1).getAsFloat();
            float density = o.get("density").getAsFloat();
            List<Part> parts = new ArrayList<>();
            for (JsonElement pe : o.getAsJsonArray("parts")) {
                Part part = part(pe.getAsJsonObject(), density, tw, th);
                Part last = parts.isEmpty() ? null : parts.get(parts.size() - 1);
                // parts that hang at the same place and move together become one (the halo's ring is one draw, not twelve)
                if (last != null && last.bone == part.bone && last.anim == part.anim && last.px == part.px && last.py == part.py && last.pz == part.pz) {
                    float[] both = java.util.Arrays.copyOf(last.quads, last.quads.length + part.quads.length);
                    System.arraycopy(part.quads, 0, both, last.quads.length, part.quads.length);
                    parts.set(parts.size() - 1, new Part(part.bone, part.px, part.py, part.pz, part.anim, both));
                } else parts.add(part);
            }
            String id = o.get("id").getAsString();
            items.put(id, new Item(id, o.get("slot").getAsString(), o.has("glow") && o.get("glow").getAsBoolean(), Collections.unmodifiableList(parts)));
        }
        return new Catalog(Collections.unmodifiableMap(items), Collections.unmodifiableMap(capes));
    }

    private static Part part(JsonObject o, float density, float tw, float th) {
        float[] pivot = floats(o.getAsJsonArray("pivot"));
        float[] rot = o.has("rot") ? floats(o.getAsJsonArray("rot")) : new float[3];
        float scale = o.has("scale") ? o.get("scale").getAsFloat() : 1f;
        Anim anim = switch (o.has("anim") ? o.get("anim").getAsString() : "") {
            case "flapL" -> Anim.FLAP_LEFT;
            case "flapR" -> Anim.FLAP_RIGHT;
            case "bob" -> Anim.BOB;
            default -> Anim.NONE;
        };
        List<float[]> quads = new ArrayList<>();
        for (JsonElement be : o.getAsJsonArray("boxes")) {
            JsonObject b = be.getAsJsonObject();
            box(quads, floats(b.getAsJsonArray("origin")), floats(b.getAsJsonArray("size")), floats(b.getAsJsonArray("uv")), b.has("inflate") ? b.get("inflate").getAsFloat() : 0f,
                    b.has("mirror") && b.get("mirror").getAsBoolean(), density, tw, th);
        }
        float[] data = new float[quads.size() * 4 * STRIDE];
        double rx = Math.toRadians(rot[0]);
        double ry = Math.toRadians(rot[1]);
        double rz = Math.toRadians(rot[2]);
        int i = 0;
        for (float[] q : quads) {
            for (int v = 0; v < 4; v++) {
                int s = v * 5;
                float[] pos = turn(q[s] * scale, q[s + 1] * scale, q[s + 2] * scale, rx, ry, rz);
                float[] n = turn(q[20], q[21], q[22], rx, ry, rz);
                data[i++] = pos[0] / 16f;
                data[i++] = pos[1] / 16f;
                data[i++] = pos[2] / 16f;
                data[i++] = q[s + 3];
                data[i++] = q[s + 4];
                data[i++] = n[0];
                data[i++] = n[1];
                data[i++] = n[2];
            }
        }
        Bone bone = "head".equals(o.get("bone").getAsString()) ? Bone.HEAD : Bone.BODY;
        return new Part(bone, pivot[0] / 16f, pivot[1] / 16f, pivot[2] / 16f, anim, data);
    }

    /** Rotates like Minecraft's model parts: x first, then y, then z (R = Rz·Ry·Rx). */
    static float[] turn(double x, double y, double z, double rx, double ry, double rz) {
        double y1 = y * Math.cos(rx) - z * Math.sin(rx);
        double z1 = y * Math.sin(rx) + z * Math.cos(rx);
        double x2 = x * Math.cos(ry) + z1 * Math.sin(ry);
        double z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
        double x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
        double y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
        return new float[] {(float) x3, (float) y3, (float) z2};
    }

    /**
     * The quads of one box – Minecraft's ModelPart.Cube: the same corners, the same unfolded texture areas and the same
     * corner order, so a texture painted for a vanilla-style box fits. Faces without area (a flat box) are left out.
     * Each quad: 4 × (x, y, z, u, v) in model pixels, then the normal.
     */
    static void box(List<float[]> out, float[] origin, float[] size, float[] uv, float grow, boolean mirror, float density, float tw, float th) {
        float w = size[0];
        float h = size[1];
        float d = size[2];
        float x0 = origin[0] - grow;
        float y0 = origin[1] - grow;
        float z0 = origin[2] - grow;
        float x1 = origin[0] + w + grow;
        float y1 = origin[1] + h + grow;
        float z1 = origin[2] + d + grow;
        if (mirror) {
            float t = x1;
            x1 = x0;
            x0 = t;
        }
        float[][] c = {
                {x0, y0, z0}, {x1, y0, z0}, {x1, y1, z0}, {x0, y1, z0},
                {x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1},
        };
        float u = uv[0];
        float v = uv[1];
        float j = u;
        float k = u + d;
        float l = u + d + w;
        float m = u + d + w + w;
        float n = u + d + w + d;
        float o = u + d + w + d + w;
        float p = v;
        float q = v + d;
        float r = v + d + h;
        boolean flat = w * d > 0;
        boolean side = d * h > 0;
        boolean face = w * h > 0;
        if (flat) quad(out, c, new int[] {5, 4, 0, 1}, k, p, l, q, 0, -1, 0, mirror, density, tw, th);
        if (flat) quad(out, c, new int[] {2, 3, 7, 6}, l, q, m, p, 0, 1, 0, mirror, density, tw, th);
        if (side) quad(out, c, new int[] {0, 4, 7, 3}, j, q, k, r, -1, 0, 0, mirror, density, tw, th);
        if (face) quad(out, c, new int[] {1, 0, 3, 2}, k, q, l, r, 0, 0, -1, mirror, density, tw, th);
        if (side) quad(out, c, new int[] {5, 1, 2, 6}, l, q, n, r, 1, 0, 0, mirror, density, tw, th);
        if (face) quad(out, c, new int[] {4, 5, 6, 7}, n, q, o, r, 0, 0, 1, mirror, density, tw, th);
    }

    private static void quad(List<float[]> out, float[][] c, int[] corners, float u1, float v1, float u2, float v2, float nx, float ny, float nz, boolean mirror, float density, float tw, float th) {
        float[][] uv = {{u2, v1}, {u1, v1}, {u1, v2}, {u2, v2}};
        float[] q = new float[23];
        for (int i = 0; i < 4; i++) {
            int src = mirror ? 3 - i : i;
            float[] corner = c[corners[src]];
            q[i * 5] = corner[0];
            q[i * 5 + 1] = corner[1];
            q[i * 5 + 2] = corner[2];
            q[i * 5 + 3] = uv[src][0] * density / tw;
            q[i * 5 + 4] = uv[src][1] * density / th;
        }
        q[20] = mirror ? -nx : nx;
        q[21] = ny;
        q[22] = nz;
        out.add(q);
    }

    private static float[] floats(JsonArray a) {
        float[] out = new float[a.size()];
        for (int i = 0; i < out.length; i++) out[i] = a.get(i).getAsFloat();
        return out;
    }
}
