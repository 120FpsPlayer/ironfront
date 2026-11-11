package pl.hammershop.client.core;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import pl.hammershop.client.Hammer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Hammer capes. Your own comes from the launcher (Hammer+). Other players' capes are asked from the shop's server
 * by their account id – in small batches, in the background, remembered for a while – so players with Hammer Client
 * see each other's capes. Nothing here can ever stall or break the game: every failure just means "no cape".
 */
public final class Capes {
    /** The capes that ship with the client (assets/hammerclient/textures/capes/&lt;id&gt;.png). */
    public static final Set<String> KNOWN = Set.of("hammer", "gold", "ember", "royal", "frost", "crimson");

    private static final long KEEP_MS = 10 * 60_000L;
    private static final int BATCH = 80;

    private record Entry(String cape, long at) {
    }

    private static final Map<String, Entry> CACHE = new ConcurrentHashMap<>();
    private static final Set<String> QUEUE = ConcurrentHashMap.newKeySet();
    /** Being asked about right now – not queued again until the answer is in. */
    private static final Set<String> PENDING = ConcurrentHashMap.newKeySet();
    private static volatile boolean busy;
    private static volatile long nextAt;
    private static int ticks;
    private static HttpClient http;

    private Capes() {
    }

    /** The cape id for a player (account id as 32 hex digits), or null. Called for every drawn player – it never waits. */
    public static String of(String uuid, boolean self) {
        Config c = Hammer.config();
        if (c == null || uuid == null) return null;
        if (self) return Hammer.plus() && KNOWN.contains(c.cape) ? c.cape : null;
        if (!c.otherCapes || c.api.isEmpty()) return null;
        // Only real (online-mode) accounts can own a cape: their ids are version 4.
        if (uuid.length() != 32 || uuid.charAt(12) != '4') return null;
        Entry e = CACHE.get(uuid);
        if ((e == null || System.currentTimeMillis() - e.at > KEEP_MS) && QUEUE.size() < 400 && !PENDING.contains(uuid)) QUEUE.add(uuid);
        return e == null || e.cape.isEmpty() ? null : e.cape;
    }

    /** 20 times per second: every two seconds asks about the players seen since the last time. */
    public static void tick() {
        if (++ticks % 40 != 0 || busy || QUEUE.isEmpty()) return;
        Config c = Hammer.config();
        if (c == null || c.api.isEmpty() || !c.otherCapes) {
            QUEUE.clear();
            return;
        }
        if (System.currentTimeMillis() < nextAt) return;
        List<String> ask = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (String id : QUEUE) {
            if (ask.size() >= BATCH) break;
            Entry known = CACHE.get(id);
            if (id.matches("[0-9a-f]{32}") && (known == null || now - known.at > KEEP_MS)) ask.add(id);
            else QUEUE.remove(id);
        }
        QUEUE.removeAll(ask);
        if (ask.isEmpty()) return;
        PENDING.addAll(ask);
        busy = true;
        try {
            if (http == null) http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(6)).build();
            HttpRequest req = HttpRequest.newBuilder(URI.create(c.api + "/capes?uuids=" + String.join(",", ask)))
                    .timeout(Duration.ofSeconds(8)).header("Accept", "application/json").header("User-Agent", "HammerClient/" + Hammer.version()).GET().build();
            http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).orTimeout(10, TimeUnit.SECONDS).whenComplete((res, err) -> {
                try {
                    if (err != null || res.statusCode() != 200) throw new IllegalStateException(err != null ? String.valueOf(err.getMessage()) : "HTTP " + res.statusCode());
                    accept(ask, res.body());
                } catch (RuntimeException e) {
                    nextAt = System.currentTimeMillis() + 60_000L; // the shop is unreachable: try again in a minute
                } finally {
                    PENDING.removeAll(ask);
                    busy = false;
                }
            });
        } catch (RuntimeException e) {
            PENDING.removeAll(ask);
            busy = false;
            nextAt = System.currentTimeMillis() + 60_000L;
        } catch (LinkageError e) {
            // a Java runtime without the HTTP client: capes of other players are simply not shown
            PENDING.removeAll(ask);
            busy = false;
            nextAt = Long.MAX_VALUE;
        }
    }

    /** Stores an answer {"capes": {"&lt;uuid&gt;": "&lt;cape&gt;"}}; everyone asked about and not in it has no cape. */
    public static void accept(List<String> asked, String body) {
        JsonObject capes = null;
        JsonElement root = JsonParser.parseString(body);
        if (root.isJsonObject() && root.getAsJsonObject().get("capes") instanceof JsonObject o) capes = o;
        if (capes == null) throw new IllegalStateException("bad answer");
        long now = System.currentTimeMillis();
        for (String id : asked) {
            JsonElement v = capes.get(id);
            String cape = v != null && v.isJsonPrimitive() && KNOWN.contains(v.getAsString()) ? v.getAsString() : "";
            CACHE.put(id, new Entry(cape, now));
        }
    }
}
