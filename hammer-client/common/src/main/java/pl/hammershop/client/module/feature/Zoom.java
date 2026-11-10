package pl.hammershop.client.module.feature;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;

/** Hold the zoom key to narrow the field of view; the mouse wheel zooms further in or out. */
public final class Zoom extends Module {
    private final Setting.Slider level = slider("zoom_level", 4f, 2f, 10f, 0.5f, "x");
    private final Setting.Bool animate = bool("smooth_zoom", true);
    private final Setting.Bool cinematic = bool("smooth_camera", true);
    private final Setting.Bool wheel = bool("scroll_zoom", true);

    private boolean active;
    private boolean savedSmooth;
    private float wheelFactor = 1f;
    private float current = 1f;
    private long last = System.nanoTime();

    public Zoom() {
        super("zoom", "zoom", Category.GAMEPLAY, true);
    }

    @Override
    public String note() {
        return Lang.t("module.zoom.note", Hammer.platform().keyName(Keys.ZOOM.id));
    }

    @Override
    public void tick() {
        Platform p = Hammer.platform();
        boolean want = p.inGameFocus() && p.keyHeld(Keys.ZOOM.id);
        if (want == active) return;
        active = want;
        if (cinematic.on()) {
            if (want) {
                savedSmooth = p.smoothCamera();
                p.setSmoothCamera(true);
            } else p.setSmoothCamera(savedSmooth);
        }
        if (!want) wheelFactor = 1f;
    }

    @Override
    public void onDisable() {
        if (active && cinematic.on()) Hammer.platform().setSmoothCamera(savedSmooth);
        active = false;
        current = 1f;
    }

    /** Called every frame by the game's FOV calculation. */
    public double apply(double fov) {
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        float target = active && enabled() ? 1f / (level.value() * wheelFactor) : 1f;
        if (animate.on()) {
            current += (target - current) * (1f - (float) Math.exp(-dt * 16f));
            if (Math.abs(current - target) < 0.001f) current = target;
        } else current = target;
        return fov * current;
    }

    /** Mouse wheel while zooming; true = keep the hotbar from scrolling. */
    public boolean scroll(double amount) {
        if (!active || !enabled() || !wheel.on() || amount == 0) return false;
        wheelFactor = Math.max(0.35f, Math.min(6f, wheelFactor * (amount > 0 ? 1.2f : 1f / 1.2f)));
        return true;
    }

    public boolean active() {
        return active && enabled();
    }
}
