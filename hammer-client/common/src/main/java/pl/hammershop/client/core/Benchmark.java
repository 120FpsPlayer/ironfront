package pl.hammershop.client.core;

import com.google.gson.JsonObject;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.ui.Draw;
import pl.hammershop.client.ui.Font;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Ui;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;

/**
 * The FPS test the launcher starts: with -Dhammerclient.benchmark=&lt;seconds&gt; the client waits until the world has
 * loaded, measures every frame for that long (slowly turning the camera in singleplayer so the whole surroundings
 * are drawn), writes the result to config/hammerclient/benchmark.json and – with -Dhammerclient.benchmark.quit=true
 * – closes the game.
 */
public final class Benchmark {
    private static final int SECONDS = seconds(System.getProperty("hammerclient.benchmark"));
    private static final boolean QUIT = Boolean.parseBoolean(System.getProperty("hammerclient.benchmark.quit", "false"));
    /** Time for the chunks around the player to load before measuring starts. */
    private static final float WARMUP = 6f;

    private static long worldSince;
    private static long startedAt;
    private static long last;
    private static float[] times = new float[4096];
    private static int count;
    private static boolean done;
    private static String result;
    private static long resultAt;

    private Benchmark() {
    }

    public static int seconds(String value) {
        if (value == null || value.isBlank()) return 0;
        try {
            int s = Integer.parseInt(value.trim());
            return s <= 0 ? 0 : Math.max(5, Math.min(180, s));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** A test was asked for and has not finished yet. */
    public static boolean running() {
        return SECONDS > 0 && !done;
    }

    /** Every HUD frame while in a world. */
    public static void frame(Draw d, Platform p) {
        if (SECONDS <= 0) return;
        long now = System.nanoTime();
        if (done) {
            if (result != null && now - resultAt < 9_000_000_000L) banner(d, result, 1f);
            return;
        }
        if (worldSince == 0) {
            worldSince = now;
            last = now;
            return;
        }
        float dt = (now - last) / 1e9f;
        last = now;
        float inWorld = (now - worldSince) / 1e9f;
        if (inWorld < WARMUP) {
            banner(d, Lang.t("benchmark.warmup"), inWorld / WARMUP);
            return;
        }
        if (startedAt == 0) {
            startedAt = now;
            return;
        }
        if (dt > 0) {
            if (count == times.length) times = Arrays.copyOf(times, count * 2);
            times[count++] = dt;
        }
        if (p.game().singleplayer()) p.turnPlayer(dt * 360f / SECONDS);
        float elapsed = (now - startedAt) / 1e9f;
        banner(d, Lang.t("benchmark.running", (int) Math.ceil(Math.max(0, SECONDS - elapsed))), elapsed / SECONDS);
        if (elapsed >= SECONDS) finish(p, elapsed);
    }

    /** {average, 1% low, lowest, highest} frames per second of these frame times (seconds each). */
    public static double[] summary(float[] frameTimes, int n) {
        if (n <= 0) return new double[] {0, 0, 0, 0};
        float[] sorted = Arrays.copyOf(frameTimes, n);
        Arrays.sort(sorted);
        double sum = 0;
        for (float t : sorted) sum += t;
        int worst = Math.max(1, n / 100);
        double worstSum = 0;
        for (int i = n - worst; i < n; i++) worstSum += sorted[i];
        return new double[] {n / sum, worst / worstSum, 1.0 / sorted[n - 1], 1.0 / sorted[0]};
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static void finish(Platform p, float elapsed) {
        done = true;
        double[] s = summary(times, count);
        JsonObject o = new JsonObject();
        o.addProperty("version", Hammer.version());
        o.addProperty("mc", p.minecraftVersion());
        o.addProperty("seconds", round1(elapsed));
        o.addProperty("frames", count);
        o.addProperty("avg", round1(s[0]));
        o.addProperty("low1", round1(s[1]));
        o.addProperty("min", round1(s[2]));
        o.addProperty("max", round1(s[3]));
        o.addProperty("finishedAt", System.currentTimeMillis());
        try {
            Path dir = p.configDir().resolve("hammerclient");
            Files.createDirectories(dir);
            Path tmp = dir.resolve("benchmark.json.tmp");
            Files.writeString(tmp, o.toString(), StandardCharsets.UTF_8);
            Files.move(tmp, dir.resolve("benchmark.json"), StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            Log.warn("Nie udało się zapisać wyniku testu FPS", e);
        }
        Log.info("Test FPS: średnio " + round1(s[0]) + ", 1% low " + round1(s[1]) + ", klatek " + count);
        result = Lang.t("benchmark.result", Math.round(s[0]), Math.round(s[1]));
        resultAt = System.nanoTime();
        if (QUIT) p.quit();
    }

    private static void banner(Draw d, String text, float progress) {
        float s = Ui.uiScale(d.g);
        d.push();
        d.scale(s);
        float w = d.g.width() / s;
        float tw = d.textWidth(text, 9, Font.BOLD);
        float cw = tw + 52;
        float x = (w - cw) / 2f;
        float y = 64; // below the top-centre HUD stack (compass, target)
        d.shadow(x, y, cw, 30, 10, 0x73000000);
        d.panel(x, y, cw, 30, 9, 0xEB140E08, Draw.alpha(Theme.accent(), 0.7f));
        d.icon("fps", x + 11, y + 8, 13, Theme.accent());
        d.textIn(text, x + 32, y, 27, 9, Theme.TEXT, Font.BOLD);
        d.rrect(x + 10, y + 25, (cw - 20) * Math.max(0f, Math.min(1f, progress)), 1.5f, 0.75f, Theme.accent());
        d.pop();
    }
}
