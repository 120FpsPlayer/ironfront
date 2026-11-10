package pl.hammershop.client.ui;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * The smooth UI font (Montserrat) as pre-rendered glyph atlases: assets/hammerclient/textures/font/&lt;name&gt;_&lt;size&gt;.png
 * with metrics in assets/hammerclient/glyphs/&lt;name&gt;_&lt;size&gt;.json (see tools/gen_assets.py). Several sizes per weight,
 * so text stays sharp from small labels to big titles; the textures use linear filtering.
 */
public enum Font {
    MEDIUM("medium", 18, 36),
    BOLD("bold", 18, 36, 72);

    private final Atlas[] atlases;

    Font(String name, int... sizes) {
        atlases = new Atlas[sizes.length];
        for (int i = 0; i < sizes.length; i++) atlases[i] = Atlas.load(name + "_" + sizes[i]);
    }

    /** The atlas for text that will be `realPx` framebuffer pixels tall: the smallest one that is big enough. */
    public Atlas atlas(float realPx) {
        for (Atlas a : atlases) if (a.size >= realPx * 0.9f) return a;
        return atlases[atlases.length - 1];
    }

    public static final class Atlas {
        public final String texture;
        public final int size;
        public final int ascent;
        public final int descent;
        public final int texW;
        public final int texH;
        /** code point → x, y, w, h, xOffset, yOffset, advance (atlas pixels) */
        private final Map<Integer, float[]> glyphs = new HashMap<>();
        private final float[] fallback;

        private Atlas(String name, JsonObject json) {
            texture = "font/" + name;
            size = json.get("size").getAsInt();
            ascent = json.get("ascent").getAsInt();
            descent = json.get("descent").getAsInt();
            texW = json.get("texW").getAsInt();
            texH = json.get("texH").getAsInt();
            for (Map.Entry<String, JsonElement> e : json.getAsJsonObject("glyphs").entrySet()) {
                float[] g = new float[7];
                for (int i = 0; i < 7; i++) g[i] = e.getValue().getAsJsonArray().get(i).getAsFloat();
                glyphs.put(Integer.parseInt(e.getKey()), g);
            }
            fallback = glyphs.getOrDefault((int) '?', new float[] {0, 0, 0, 0, 0, 0, size / 2f});
        }

        static Atlas load(String name) {
            String path = "/assets/hammerclient/glyphs/" + name + ".json";
            try (InputStream in = Font.class.getResourceAsStream(path)) {
                if (in == null) throw new IllegalStateException("Missing font metrics " + path);
                return new Atlas(name, JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject());
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
        }

        public float[] glyph(int codePoint) {
            float[] g = glyphs.get(codePoint);
            return g != null ? g : fallback;
        }

        /** Width of `text` in atlas pixels. */
        public float width(String text) {
            float w = 0;
            for (int i = 0; i < text.length(); i++) w += glyph(text.charAt(i))[6];
            return w;
        }
    }
}
