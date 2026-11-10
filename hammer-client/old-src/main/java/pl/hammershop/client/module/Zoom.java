package pl.hammershop.client.module;

import net.minecraft.client.Minecraft;
import net.minecraft.util.Mth;
import pl.hammershop.client.HammerClient;

/** Zoom (C by default): narrows the field of view smoothly; optional cinematic camera while zooming. */
public final class Zoom extends Module {
    private static float previous = 1f;
    private static float current = 1f;
    private static boolean smoothWasOn;
    private static boolean zooming;

    public Zoom() {
        super("zoom", Category.GAMEPLAY, true);
    }

    @Override
    public void tick(Minecraft mc) {
        boolean want = enabled() && mc.screen == null && HammerClient.zoomKey.isDown();
        if (want != zooming) {
            zooming = want;
            if (HammerClient.config().smoothZoom) {
                if (want) {
                    smoothWasOn = mc.options.smoothCamera;
                    mc.options.smoothCamera = true;
                } else {
                    mc.options.smoothCamera = smoothWasOn;
                }
            }
        }
        float target = zooming ? HammerClient.config().zoomFactor : 1f;
        previous = current;
        current += (target - current) * 0.5f;
        if (Math.abs(current - target) < 0.001f) current = target;
    }

    public static double fovMultiplier(float partialTick) {
        return Mth.lerp(partialTick, previous, current);
    }
}
