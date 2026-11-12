package pl.hammershop.client.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Game;
import pl.hammershop.client.module.Modules;

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
 * Who else plays on Hammer Client – for the badge in front of names in the player list (Tab): H, or H+ with Hammer+.
 * The client tells the shop's server "this account is playing now" and asks about the accounts on the list, in small
 * batches, in the background, remembered for a while. The server only keeps that in memory for a few minutes.
 * Nothing here can stall or break the game: every failure just means "no badge".
 */
public final class Presence {
    public static final int NONE = 0;
    public static final int HAMMER = 1;
    public static final int PLUS = 2;

    private static final long KEEP_MS = 2 * 60_000L;
    /** "I am playing" is said again at least this often (the server forgets after five minutes). */
    private static final long BEAT_MS = 90_000L;
    private static final int BATCH = 80;

    private record Entry(int badge, long at) {
    }

    private static final Map<String, Entry> CACHE = new ConcurrentHashMap<>();
    private static final Set<String> QUEUE = ConcurrentHashMap.newKeySet();
    /** Being asked about right now – not queued again until the answer is in. */
    private static final Set<String> PENDING = ConcurrentHashMap.newKeySet();
    private static volatile boolean busy;
    private static volatile long nextAt;
    private static volatile long lastBeat;
    private static int ticks;
    private static HttpClient http;

    private Presence() {
    }

    private static boolean on() {
        return Modules.tabBadge != null && Modules.tabBadge.enabled();
    }

    /** The badge of a player (account id as 32 hex digits). Called for every name on the list – it never waits. */
    public static int of(String uuid, boolean self) {
        Config c = Hammer.config();
        if (c == null || uuid == null || !on()) return NONE;
        if (self) return Modules.tabBadge.own() ? (Hammer.plus() ? PLUS : HAMMER) : NONE;
        if (c.api.isEmpty()) return NONE;
        // Only real (online-mode) accounts play on Hammer Launcher: their ids are version 4.
        if (uuid.length() != 32 || uuid.charAt(12) != '4') return NONE;
        Entry e = CACHE.get(uuid);
        if ((e == null || System.currentTimeMillis() - e.at > KEEP_MS) && QUEUE.size() < 600 && !PENDING.contains(uuid)) QUEUE.add(uuid);
        return e == null ? NONE : e.badge;
    }

    /** How many of these accounts are known to play on Hammer Client (the player counts as one). */
    public static int count(List<String> uuids, String self) {
        int n = 0;
        for (String id : uuids) if (of(id, id.equals(self)) != NONE || id.equals(self)) n++;
        return n;
    }

    /** 20 times per second: every two seconds asks about the names seen since the last time, and says "I am here". */
    public static void tick() {
        if (++ticks % 40 != 0 || busy) return;
        Config c = Hammer.config();
        Game game = Hammer.game();
        if (c == null || c.api.isEmpty() || !on() || !game.inWorld() || game.singleplayer()) {
            QUEUE.clear();
            return;
        }
        long now = System.currentTimeMillis();
        if (now < nextAt) return;
        String me = Modules.tabBadge.announce() ? game.playerUuid() : "";
        boolean beat = !me.isEmpty() && now - lastBeat > BEAT_MS;
        if (QUEUE.isEmpty() && !beat) return;
        List<String> ask = new ArrayList<>();
        for (String id : QUEUE) {
            if (ask.size() >= BATCH) break;
            Entry known = CACHE.get(id);
            if (id.matches("[0-9a-f]{32}") && (known == null || now - known.at > KEEP_MS)) ask.add(id);
            else QUEUE.remove(id);
        }
        QUEUE.removeAll(ask);
        if (ask.isEmpty() && !beat) return;
        PENDING.addAll(ask);
        busy = true;
        try {
            if (http == null) http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(6)).build();
            HttpRequest req = HttpRequest.newBuilder(URI.create(c.api + "/presence"))
                    .timeout(Duration.ofSeconds(8)).header("Accept", "application/json").header("Content-Type", "application/json")
                    .header("User-Agent", "HammerClient/" + Hammer.version()).PUT(HttpRequest.BodyPublishers.ofString(request(me, ask))).build();
            http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).orTimeout(10, TimeUnit.SECONDS).whenComplete((res, err) -> {
                try {
                    if (err != null || res.statusCode() != 200) throw new IllegalStateException(err != null ? String.valueOf(err.getMessage()) : "HTTP " + res.statusCode());
                    accept(ask, res.body());
                    if (!me.isEmpty()) lastBeat = System.currentTimeMillis();
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
            // a Java runtime without the HTTP client: other players simply get no badge
            PENDING.removeAll(ask);
            busy = false;
            nextAt = Long.MAX_VALUE;
        }
    }

    /** {"me": "<uuid>" | null, "uuids": [...]} */
    public static String request(String me, List<String> ask) {
        JsonObject body = new JsonObject();
        if (me == null || me.isEmpty()) body.add("me", com.google.gson.JsonNull.INSTANCE);
        else body.addProperty("me", me);
        JsonArray list = new JsonArray();
        for (String id : ask) list.add(id);
        body.add("uuids", list);
        return body.toString();
    }

    /** Stores an answer {"players": {"&lt;uuid&gt;": "h" | "p"}}; everyone asked about and not in it has no badge. */
    public static void accept(List<String> asked, String body) {
        JsonObject players = null;
        JsonElement root = JsonParser.parseString(body);
        if (root.isJsonObject() && root.getAsJsonObject().get("players") instanceof JsonObject o) players = o;
        if (players == null) throw new IllegalStateException("bad answer");
        long now = System.currentTimeMillis();
        for (String id : asked) {
            JsonElement v = players.get(id);
            String kind = v != null && v.isJsonPrimitive() ? v.getAsString() : "";
            CACHE.put(id, new Entry("p".equals(kind) ? PLUS : "h".equals(kind) ? HAMMER : NONE, now));
        }
    }

    /** Forgets every answer (the tests start clean). */
    public static void clear() {
        CACHE.clear();
        QUEUE.clear();
        PENDING.clear();
        lastBeat = 0;
        nextAt = 0;
    }
}
