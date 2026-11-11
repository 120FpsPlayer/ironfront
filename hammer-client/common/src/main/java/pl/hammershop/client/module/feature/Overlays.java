package pl.hammershop.client.module.feature;

import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;

/** Less clutter on the screen: lower fire when you burn, no pumpkin overlay, no dark vignette. */
public final class Overlays extends Module {
    private final Setting.Slider fire = slider("low_fire", 0.6f, 0f, 1f, 0.05f, "%");
    private final Setting.Bool pumpkin = bool("no_pumpkin", true);
    private final Setting.Bool vignette = bool("no_vignette", false);

    public Overlays() {
        super("overlays", "layers", Category.VISUAL, false);
    }

    /** How far down the fire is pushed, in the units of the game's first-person overlay (0 = vanilla). */
    public float fireOffset() {
        return fire.value() * 0.45f;
    }

    public boolean noPumpkin() {
        return pumpkin.on();
    }

    public boolean noVignette() {
        return vignette.on();
    }
}
