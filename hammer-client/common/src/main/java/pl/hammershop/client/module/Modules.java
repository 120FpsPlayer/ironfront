package pl.hammershop.client.module;

import pl.hammershop.client.api.Platform;
import pl.hammershop.client.api.Platform.Feature;
import pl.hammershop.client.module.feature.Crosshair;
import pl.hammershop.client.module.feature.Freelook;
import pl.hammershop.client.module.feature.Tweaks;
import pl.hammershop.client.module.feature.Zoom;
import pl.hammershop.client.module.hud.Armor;
import pl.hammershop.client.module.hud.Compass;
import pl.hammershop.client.module.hud.DurabilityWarning;
import pl.hammershop.client.module.hud.HealthWarning;
import pl.hammershop.client.module.hud.InfoHuds;
import pl.hammershop.client.module.hud.InventoryHud;
import pl.hammershop.client.module.hud.ItemCounter;
import pl.hammershop.client.module.hud.Keystrokes;
import pl.hammershop.client.module.hud.Potions;
import pl.hammershop.client.module.hud.TargetHud;
import pl.hammershop.client.module.hud.Watermark;

import java.util.ArrayList;
import java.util.List;

/** Every module of Hammer Client, in the order the module panel shows them. */
public final class Modules {
    public static final List<Module> ALL = new ArrayList<>();
    public static final List<HudModule> HUD = new ArrayList<>();

    public static Zoom zoom;
    public static Freelook freelook;
    public static Crosshair crosshair;
    public static Tweaks.TimeChanger timeChanger;
    public static Tweaks.ClearWeather weather;

    private Modules() {
    }

    /** Builds the list, leaving out what this game version cannot do. */
    public static void init(Platform p) {
        ALL.clear();
        HUD.clear();
        // HUD
        add(new InfoHuds.Fps());
        add(new InfoHuds.Cps());
        add(new Keystrokes());
        add(new InfoHuds.Coords());
        add(new Compass());
        add(new Armor());
        add(new Potions());
        add(new InfoHuds.Ping());
        add(new InfoHuds.Clock());
        add(new InventoryHud());
        add(new ItemCounter());
        if (p.supports(Feature.COMBO)) {
            add(new InfoHuds.Combo());
            add(new InfoHuds.Reach());
        }
        add(new TargetHud());
        add(new InfoHuds.Health());
        add(new InfoHuds.BlockInfo());
        add(new InfoHuds.Speed());
        add(new InfoHuds.Saturation());
        add(new InfoHuds.Server());
        if (p.supports(Feature.TPS)) add(new InfoHuds.Tps());
        add(new InfoHuds.Memory());
        add(new InfoHuds.Day());
        add(new InfoHuds.Light());
        add(new InfoHuds.Session());
        add(new InfoHuds.Stopwatch());
        add(new Watermark());
        // gameplay
        if (p.supports(Feature.ZOOM)) add(zoom = new Zoom());
        if (p.supports(Feature.FREELOOK)) add(freelook = new Freelook());
        add(new Tweaks.ToggleSprint());
        add(new Tweaks.ToggleSneak());
        add(new DurabilityWarning());
        add(new HealthWarning());
        // visual
        if (p.supports(Feature.CROSSHAIR)) add(crosshair = new Crosshair());
        if (p.supports(Feature.FULLBRIGHT)) add(new Tweaks.Fullbright());
        if (p.supports(Feature.TIME_CHANGER)) add(timeChanger = new Tweaks.TimeChanger());
        if (p.supports(Feature.WEATHER)) add(weather = new Tweaks.ClearWeather());
        add(new Tweaks.NoHurtCam());
        add(new Tweaks.StaticFov());
    }

    private static void add(Module m) {
        ALL.add(m);
        if (m instanceof HudModule h) HUD.add(h);
    }

    /** Applies the state of the active profile (at start and when the profile changes). */
    public static void apply(boolean first) {
        for (Module m : ALL) {
            if (m.enabled()) m.onEnable();
            else if (!first) m.onDisable();
        }
    }

    public static void tick() {
        for (Module m : ALL) if (m.enabled()) m.tick();
    }

    public static Module byId(String id) {
        for (Module m : ALL) if (m.id.equals(id)) return m;
        return null;
    }
}
