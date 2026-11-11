package pl.hammershop.client.api;

/** Key bindings of Hammer Client (players can rebind them in the game's Controls). GLFW key codes. */
public enum Keys {
    MENU("menu", 344),       // right Shift
    ZOOM("zoom", 67),        // C
    FREELOOK("freelook", 342), // left Alt
    STOPWATCH("stopwatch", -1),
    HUD("hud", -1),
    WAYPOINTS("waypoints", 66); // B

    public final String id;
    public final int defaultKey;

    Keys(String id, int defaultKey) {
        this.id = id;
        this.defaultKey = defaultKey;
    }
}
