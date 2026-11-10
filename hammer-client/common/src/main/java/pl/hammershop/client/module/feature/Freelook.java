package pl.hammershop.client.module.feature;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;

/** Look around in third person without turning your character (hold or toggle the freelook key). */
public final class Freelook extends Module {
    private final Setting.Choice mode = choice("key_mode", 0, "hold", "toggle");

    private boolean active;
    private int savedCamera;
    private float yaw;
    private float pitch;

    public Freelook() {
        super("freelook", "freelook", Category.GAMEPLAY, false);
    }

    @Override
    public String note() {
        return Lang.t("module.freelook.note", Hammer.platform().keyName(Keys.FREELOOK.id));
    }

    @Override
    public void tick() {
        Platform p = Hammer.platform();
        boolean want;
        if (mode.get() == 0) want = p.inGameFocus() && p.keyHeld(Keys.FREELOOK.id);
        else {
            want = active;
            if (p.keyPressed(Keys.FREELOOK.id)) want = !want;
            if (!Hammer.game().inWorld()) want = false;
        }
        if (want && !active) {
            yaw = Hammer.game().yaw();
            pitch = Hammer.game().pitch();
            savedCamera = p.cameraMode();
            if (savedCamera == 0) p.setCameraMode(1);
            active = true;
        } else if (!want && active) stop();
    }

    private void stop() {
        active = false;
        Hammer.platform().setCameraMode(savedCamera);
    }

    @Override
    public void onDisable() {
        if (active) stop();
    }

    public boolean active() {
        return active && enabled();
    }

    /** Mouse movement while freelooking (the same units the game turns the player with). */
    public void turn(double dx, double dy) {
        yaw += (float) dx * 0.15f;
        pitch = Math.max(-90f, Math.min(90f, pitch + (float) dy * 0.15f));
    }

    public float yaw() {
        return yaw;
    }

    public float pitch() {
        return pitch;
    }
}
