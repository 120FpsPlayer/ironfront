package pl.hammershop.client.module.feature;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Game;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.module.TextHud;

import java.util.List;

/** Small switches built on the game's own options and a few client-side visuals. */
public final class Tweaks {
    private Tweaks() {
    }

    /** Vanilla "Sprint: Toggle" with a small indicator on the HUD. */
    public static final class ToggleSprint extends TextHud {
        private final Setting.Bool indicator = bool("indicator", true);

        public ToggleSprint() {
            super("togglesprint", "sprint", Category.GAMEPLAY, false, Anchor.TOP_LEFT);
            order = 7;
        }

        @Override
        public void onEnable() {
            Hammer.platform().setToggleSprint(true);
        }

        @Override
        public void onDisable() {
            Hammer.platform().setToggleSprint(false);
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            if (!indicator.on()) return;
            if (g.sprinting() || editor) out.add(line("", Lang.t("hud.sprinting")));
        }
    }

    /** Vanilla "Sneak: Toggle". */
    public static final class ToggleSneak extends Module {
        public ToggleSneak() {
            super("togglesneak", "sneak", Category.GAMEPLAY, false);
        }

        @Override
        public void onEnable() {
            Hammer.platform().setToggleSneak(true);
        }

        @Override
        public void onDisable() {
            Hammer.platform().setToggleSneak(false);
        }
    }

    /** Brightness far above the vanilla maximum: caves and nights are fully lit. */
    public static final class Fullbright extends Module {
        private static final double BRIGHT = 14.0;

        public Fullbright() {
            super("fullbright", "fullbright", Category.VISUAL, false);
        }

        @Override
        public void onEnable() {
            double now = Hammer.platform().gamma();
            if (now <= 1.0) data().values.put("saved_gamma", now);
            Hammer.platform().setGamma(BRIGHT);
        }

        @Override
        public void onDisable() {
            Object saved = data().values.get("saved_gamma");
            Hammer.platform().setGamma(saved instanceof Number n ? Math.max(0, Math.min(1, n.doubleValue())) : 0.5);
        }

        @Override
        public void tick() {
            // The options screen clamps brightness back to 0–1; put it up again.
            if (Hammer.platform().gamma() < BRIGHT - 0.5) Hammer.platform().setGamma(BRIGHT);
        }
    }

    /** No camera shake when you take damage (vanilla "Damage Tilt" at 0). */
    public static final class NoHurtCam extends Module {
        public NoHurtCam() {
            super("nohurtcam", "hurtcam", Category.VISUAL, false);
        }

        @Override
        public void onEnable() {
            double now = Hammer.platform().damageTilt();
            if (now > 0) data().values.put("saved", now);
            Hammer.platform().setDamageTilt(0);
        }

        @Override
        public void onDisable() {
            Hammer.platform().setDamageTilt(data().values.get("saved") instanceof Number n ? n.doubleValue() : 1.0);
        }
    }

    /** The field of view no longer jumps when sprinting or under speed effects (vanilla "FOV Effects" at 0). */
    public static final class StaticFov extends Module {
        public StaticFov() {
            super("staticfov", "fov", Category.VISUAL, false);
        }

        @Override
        public void onEnable() {
            double now = Hammer.platform().fovEffects();
            if (now > 0) data().values.put("saved", now);
            Hammer.platform().setFovEffects(0);
        }

        @Override
        public void onDisable() {
            Hammer.platform().setFovEffects(data().values.get("saved") instanceof Number n ? n.doubleValue() : 1.0);
        }
    }

    /** Your own time of day – only you see it. */
    public static final class TimeChanger extends Module {
        private static final long[] TIMES = {1000, 6000, 12000, 13000, 18000, 23000};
        private final Setting.Choice time = choice("time_of_day", 1, "time_morning", "time_noon", "time_sunset", "time_night", "time_midnight", "time_sunrise");

        public TimeChanger() {
            super("timechanger", "time", Category.VISUAL, false);
        }

        public long time() {
            return TIMES[time.get()];
        }
    }

    /** Always clear skies on your screen. */
    public static final class ClearWeather extends Module {
        public ClearWeather() {
            super("weather", "weather", Category.VISUAL, false);
        }
    }
}
