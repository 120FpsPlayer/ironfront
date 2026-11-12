package pl.hammershop.client.module.hud;

import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;

/** The frame rate of the last seconds as a graph, with the lowest value – a dip is easy to spot. */
public final class FpsGraph extends HudModule {
    /** One bar per quarter of a second: the last 11 seconds. */
    private static final int SAMPLES = 44;
    private static final long STEP = 250_000_000L;

    private final Setting.Bool background = bool("background", true);
    private final Setting.Color backgroundColor = color("background_color", 0x70000000, false);
    private final Setting.Color graphColor = color("graph_color", 0xFFFF9F43, true);
    private final Setting.Bool lowest = bool("lowest", true);

    private final float[] samples = new float[SAMPLES];
    private int count;
    private int next;
    private long started;
    private int frames;

    public FpsGraph() {
        super("fpsgraph", "graph", false, Anchor.BOTTOM_LEFT);
        order = 5;
    }

    private void add(float fps) {
        samples[next] = fps;
        next = (next + 1) % SAMPLES;
        if (count < SAMPLES) count++;
    }

    /** The i-th sample, oldest first. */
    private float at(int i) {
        return samples[Math.floorMod(next - count + i, SAMPLES)];
    }

    @Override
    protected void draw(HudCanvas c) {
        long now = System.nanoTime();
        // Not drawn for a while (the module or the whole HUD was off): the gap is not a frame.
        if (started == 0 || now - started > 2_000_000_000L) {
            started = now;
            frames = 0;
        }
        frames++;
        if (now - started >= STEP) {
            add(frames * 1e9f / (now - started));
            started = now;
            frames = 0;
        }
        if (count == 0 && c.editor) for (int i = 0; i < SAMPLES; i++) add(200 + 40 * (float) Math.sin(i * 0.45) - (i % 13 == 7 ? 110 : 0));

        float w = SAMPLES * 2 + 8;
        float h = 40;
        if (background.on()) c.plate(w, h, backgroundColor.get());
        float min = Float.MAX_VALUE;
        float max = 0;
        float sum = 0;
        for (int i = 0; i < count; i++) {
            float v = at(i);
            min = Math.min(min, v);
            max = Math.max(max, v);
            sum += v;
        }
        float avg = count == 0 ? 0 : sum / count;
        c.text("FPS " + (count == 0 ? c.game.fps() : Math.round(at(count - 1))), 4, 3, 0xFFFFFFFF, true);
        if (lowest.on() && count > 0) {
            String low = "min " + Math.round(min);
            c.text(low, w - 4 - c.textWidth(low), 3, 0xFFC8C8C8, true);
        }
        float top = Math.max(30f, max * 1.1f);
        float gy = 14;
        float gh = h - gy - 4;
        int color = graphColor.argb();
        for (int i = 0; i < count; i++) {
            float v = at(i);
            float bar = Math.max(1f, Math.round(gh * Math.min(1f, v / top)));
            // A dip stands out: under half of the average is red, under four fifths yellow.
            int tint = v < avg * 0.5f ? 0xFFFF6B6B : v < avg * 0.8f ? 0xFFFFD43B : color;
            c.d.fill(4 + (SAMPLES - count + i) * 2, gy + gh - bar, 2, bar, tint);
        }
        c.size(w, h);
    }
}
