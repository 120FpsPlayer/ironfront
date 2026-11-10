package pl.hammershop.client.api;

import java.util.List;

/** Live facts about the running game, read by the modules. Everything is safe to call outside a world. */
public interface Game {
    boolean inWorld();

    int fps();

    String playerName();

    double x();

    double y();

    double z();

    /** Yaw in degrees (Minecraft convention: 0 = south, 90 = west). */
    float yaw();

    float pitch();

    /** Localised biome name at the player, or "". */
    String biome();

    /** Latency in ms, or -1 in singleplayer / unknown. */
    int ping();

    /** Server address, or "" in singleplayer. */
    String server();

    long dayTime();

    float health();

    float maxHealth();

    int food();

    float saturation();

    int hurtTime();

    boolean sprinting();

    boolean sneaking();

    /** Block light at the player's feet (0–15). */
    int light();

    List<Effect> effects();

    /** Helmet, chestplate, leggings, boots, main hand, off hand – empty slots included. */
    List<Item> equipment();

    /** The 36 inventory slots (0–8 hotbar, then the three rows), empty slots included. */
    List<Item> inventory();

    /** Total armour points of the player (0–20). */
    int armor();

    /** Extra (yellow) hearts in half-heart points. */
    float absorption();

    /** The mob or player under the crosshair, or null. */
    Target target();

    /** Localised name of the block under the crosshair, or "". */
    String block();

    record Target(String name, float health, float maxHealth, double distance, boolean player) {
    }

    record Effect(String name, int amplifier, int ticks, boolean infinite, int rgb, boolean beneficial) {
    }

    /** `handle` goes back to {@link Gfx#item}. */
    record Item(Object handle, String id, String name, int count, int damage, int maxDamage) {
        public static final Item EMPTY = new Item(null, "", "", 0, 0, 0);

        public boolean empty() {
            return handle == null || count <= 0;
        }

        public boolean damageable() {
            return maxDamage > 0;
        }

        public int left() {
            return maxDamage - damage;
        }
    }
}
