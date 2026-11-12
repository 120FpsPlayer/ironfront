package pl.hammershop.client.module.hud;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.core.Fmt;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.core.Presence;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.module.TextHud;

import java.util.List;

/** More "label: value" HUD modules: experience, air, the world's clock, weather, players, the item in hand and position helpers. */
public final class MoreHuds {
    private MoreHuds() {
    }

    private static String hud(String key) {
        return Lang.t("hud." + key);
    }

    private static String two(long n) {
        return n < 10 ? "0" + n : String.valueOf(n);
    }

    /** Experience level and how far the next one is. */
    public static final class Xp extends TextHud {
        private final Setting.Bool progress = bool("xp_progress", true);

        public Xp() {
            super("xp", "xp", false, Anchor.BOTTOM_LEFT);
            order = 3;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            String v = String.valueOf(editor && !g.inWorld() ? 30 : g.xpLevel());
            if (progress.on()) v += " (" + Math.round(Math.max(0f, Math.min(1f, g.xpProgress())) * 100) + "%)";
            out.add(line(hud("level"), v));
        }
    }

    /** Seconds of air left – shown while it is running out. */
    public static final class Air extends TextHud {
        private final Setting.Bool always = bool("always_visible", false);

        public Air() {
            super("air", "air", false, Anchor.BOTTOM_LEFT);
            order = 4;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            int max = Math.max(1, g.maxAir());
            int air = g.air();
            if (air >= max && !always.on()) {
                if (!editor) return;
                air = max * 2 / 5;
            }
            out.add(line(hud("air"), Fmt.num(Math.max(0, Math.min(air, max)) / 20.0, 1) + " s"));
        }
    }

    /** The clock of the world you are in (sunrise is 6:00) and the phase of the moon. */
    public static final class WorldTime extends TextHud {
        private final Setting.Bool twelve = bool("twelve_hour", false);
        private final Setting.Bool moon = bool("moon_phase", false);

        public WorldTime() {
            super("worldtime", "worldtime", false, Anchor.TOP_RIGHT);
            order = 7;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            long t = g.dayTime();
            long ofDay = Math.floorMod(t + 6000L, 24000L); // 0 = midnight
            long hours = ofDay / 1000;
            long minutes = ofDay % 1000 * 60 / 1000;
            String v = twelve.on() ? (hours % 12 == 0 ? 12 : hours % 12) + ":" + two(minutes) + (hours < 12 ? " AM" : " PM") : two(hours) + ":" + two(minutes);
            out.add(line(hud("world_time"), v));
            if (moon.on()) out.add(line(hud("moon"), Lang.t("moon." + Math.floorMod(Math.floorDiv(t, 24000L), 8L))));
        }
    }

    /** The real weather of the world – also when the "clear sky" module hides the rain. */
    public static final class WeatherHud extends TextHud {
        public WeatherHud() {
            super("weatherhud", "weather", false, Anchor.TOP_RIGHT);
            order = 8;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            out.add(line(hud("weather"), Lang.t("weather." + Math.max(0, Math.min(2, g.weather())))));
        }
    }

    /** How many players are on the server – and how many of them play on Hammer Client. */
    public static final class Players extends TextHud {
        private final Setting.Bool hammer = bool("hammer_players", true);
        private int hammers;
        private long counted;

        public Players() {
            super("players", "users", false, Anchor.TOP_RIGHT);
            order = 9;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            List<String> online = g.onlinePlayers();
            if (online.isEmpty() && !editor) return;
            out.add(line(hud("players"), String.valueOf(online.isEmpty() ? 24 : online.size())));
            if (!hammer.on()) return;
            long now = System.currentTimeMillis();
            if (now - counted > 1000) {
                counted = now;
                hammers = online.isEmpty() ? 5 : Presence.count(online, g.playerUuid());
            }
            out.add(line("Hammer", String.valueOf(hammers)));
        }
    }

    /** The item in your hand: how many of it you carry, or how much of the tool is left. */
    public static final class HeldItem extends TextHud {
        private final Setting.Bool total = bool("total_count", true);
        private final Setting.Bool durability = bool("durability", true);

        public HeldItem() {
            super("helditem", "hand", false, Anchor.BOTTOM_CENTER);
            order = 2;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            List<Game.Item> worn = g.equipment();
            Game.Item hand = worn.size() > 4 ? worn.get(4) : Game.Item.EMPTY;
            if (hand.empty()) {
                if (!editor) return;
                out.add(line("", hud("sample_item")));
                if (durability.on()) out.add(line(hud("item_durability"), "1204 / 1561 (77%)"));
                return;
            }
            out.add(line("", hand.name()));
            if (hand.damageable()) {
                if (durability.on()) out.add(line(hud("item_durability"), hand.left() + " / " + hand.maxDamage() + " (" + Math.round(hand.left() * 100f / hand.maxDamage()) + "%)"));
            } else if (total.on()) {
                int sum = 0;
                for (Game.Item i : g.inventory()) if (!i.empty() && i.id().equals(hand.id())) sum += i.count();
                Game.Item off = worn.size() > 5 ? worn.get(5) : Game.Item.EMPTY;
                if (!off.empty() && off.id().equals(hand.id())) sum += off.count();
                out.add(line(hud("carried"), String.valueOf(Math.max(sum, hand.count()))));
            }
        }
    }

    /** Where you look, in degrees: yaw (−180…180, 0 = south) and pitch (−90 = straight up). */
    public static final class Rotation extends TextHud {
        public Rotation() {
            super("rotation", "rotation", false, Anchor.TOP_LEFT);
            order = 7;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            float yaw = ((g.yaw() % 360f) + 540f) % 360f - 180f;
            out.add(line(hud("rotation"), Fmt.num(yaw, 1) + " / " + Fmt.num(g.pitch(), 1)));
        }
    }

    /** Where a portal built here comes out: the Nether's coordinates in the Overworld and the other way round. */
    public static final class Portal extends TextHud {
        public Portal() {
            super("portal", "portal", false, Anchor.TOP_LEFT);
            order = 8;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            long x = (long) Math.floor(g.x());
            long z = (long) Math.floor(g.z());
            String dim = g.dimension();
            if (dim.equals("minecraft:the_nether")) out.add(line(hud("overworld"), x * 8 + " " + z * 8));
            else if (dim.equals("minecraft:overworld") || editor) out.add(line(hud("nether"), Math.floorDiv(x, 8L) + " " + Math.floorDiv(z, 8L)));
        }
    }

    /** The chunk you stand in and your place inside it (0–15) – for farms and chunk borders. */
    public static final class Chunk extends TextHud {
        private final Setting.Bool inside = bool("in_chunk", true);

        public Chunk() {
            super("chunk", "chunk", false, Anchor.TOP_LEFT);
            order = 9;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            long x = (long) Math.floor(g.x());
            long z = (long) Math.floor(g.z());
            out.add(line("Chunk", Math.floorDiv(x, 16L) + " " + Math.floorDiv(z, 16L)));
            if (inside.on()) out.add(line(hud("in_chunk"), Math.floorMod(x, 16L) + " " + Math.floorMod(z, 16L)));
        }
    }

    /** How far your next hit is charged – a hit at 100% does full damage. */
    public static final class AttackCharge extends TextHud {
        private final Setting.Bool always = bool("always_visible", false);

        public AttackCharge() {
            super("attack", "attack", false, Anchor.MIDDLE);
            order = 2;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            float c = Math.max(0f, Math.min(1f, g.attackCharge()));
            if (c >= 0.999f && !always.on()) {
                if (!editor) return;
                c = 0.72f;
            }
            out.add(line(hud("attack"), Math.round(c * 100) + "%"));
        }
    }
}
