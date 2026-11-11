package pl.hammershop.client.module.feature;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;

/** Waypoints: mark places (home, mine, portal…) and see where they are; the list opens with its own key. */
public final class WaypointsModule extends Module {
    private final Setting.Bool death = bool("death_point", true);
    private final Setting.Bool distance = bool("show_distance", true);
    private final Setting.Slider marker = slider("marker_scale", 1f, 0.6f, 2f, 0.1f, "x");

    public WaypointsModule() {
        super("waypoints", "pin", Category.GAMEPLAY, true);
    }

    @Override
    public String note() {
        return Lang.t("module.waypoints.note", Hammer.platform().keyName(Keys.WAYPOINTS.id));
    }

    public boolean deathPoint() {
        return death.on();
    }

    public boolean showDistance() {
        return distance.on();
    }

    public float markerScale() {
        return marker.value();
    }
}
