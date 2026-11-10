package pl.hammershop.client.core;

import com.google.gson.JsonElement;
import com.google.gson.JsonParser;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Our texts: assets/hammerclient/lang/pl_pl.json for Polish players, en_us.json for everyone else. */
public final class Lang {
    private static final Map<String, String> TEXTS = new HashMap<>();
    private static String loaded = "";

    private Lang() {
    }

    public static void load(String code) {
        String lang = code != null && code.toLowerCase().startsWith("pl") ? "pl_pl" : "en_us";
        if (lang.equals(loaded)) return;
        TEXTS.clear();
        read("en_us");
        if (!lang.equals("en_us")) read(lang);
        loaded = lang;
    }

    private static void read(String lang) {
        try (InputStream in = Lang.class.getResourceAsStream("/assets/hammerclient/lang/" + lang + ".json")) {
            if (in == null) return;
            for (Map.Entry<String, JsonElement> e : JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject().entrySet()) {
                TEXTS.put(e.getKey(), e.getValue().getAsString());
            }
        } catch (Exception e) {
            Log.warn("Nie udało się wczytać tłumaczeń " + lang, e);
        }
    }

    public static boolean has(String key) {
        return TEXTS.containsKey("hammerclient." + key);
    }

    /** Text for "hammerclient.&lt;key&gt;"; each %s is replaced by the next argument. */
    public static String t(String key, Object... args) {
        String s = TEXTS.get("hammerclient." + key);
        if (s == null) return key;
        for (Object a : args) s = s.replaceFirst("%s", java.util.regex.Matcher.quoteReplacement(String.valueOf(a)));
        return s;
    }
}
