package pl.hammershop.client.module.hud;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Game;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.core.Fmt;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.module.TextHud;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/** The simple "label: value" HUD modules. Default places: left column top-down, right column for time / server. */
public final class InfoHuds {
    private InfoHuds() {
    }

    private static String hud(String key) {
        return Lang.t("hud." + key);
    }

    public static final class Fps extends TextHud {
        public Fps() {
            super("fps", "fps", true, Anchor.TOP_LEFT);
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            out.add(line("FPS", String.valueOf(g.fps())));
        }
    }

    public static final class Cps extends TextHud {
        private final Setting.Bool both = bool("right_button", true);

        public Cps() {
            super("cps", "cps", true, Anchor.TOP_LEFT);
            order = 1;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            String v = String.valueOf(Hammer.stats().cpsLeft());
            if (both.on()) v += " | " + Hammer.stats().cpsRight();
            out.add(line("CPS", v));
        }
    }

    public static final class Ping extends TextHud {
        public Ping() {
            super("ping", "ping", true, Anchor.TOP_LEFT);
            order = 2;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            int ms = g.ping();
            if (ms < 0 && !editor) return;
            out.add(line("Ping", (ms < 0 ? 23 : ms) + " ms"));
        }
    }

    public static final class Coords extends TextHud {
        private final Setting.Choice layout = choice("layout", 0, "one_line", "three_lines");
        private final Setting.Bool direction = bool("direction", true);
        private final Setting.Bool biome = bool("biome", true);

        public Coords() {
            super("coords", "coords", true, Anchor.TOP_LEFT);
            order = 3;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            long x = (long) Math.floor(g.x());
            long y = (long) Math.floor(g.y());
            long z = (long) Math.floor(g.z());
            if (layout.get() == 0) out.add(line("XYZ", x + " " + y + " " + z));
            else {
                out.add(line("X", String.valueOf(x)));
                out.add(line("Y", String.valueOf(y)));
                out.add(line("Z", String.valueOf(z)));
            }
            if (direction.on()) out.add(line(hud("facing"), facing(g.yaw())));
            if (biome.on() && !g.biome().isEmpty()) out.add(line(hud("biome"), g.biome()));
        }

        /** Minecraft yaw: 0 = south (+Z), 90 = west (−X), 180 = north (−Z), 270 = east (+X). */
        static String facing(float yaw) {
            int i = Math.floorMod(Math.round(yaw / 90f), 4);
            return switch (i) {
                case 0 -> Lang.t("direction.south") + " (+Z)";
                case 1 -> Lang.t("direction.west") + " (-X)";
                case 2 -> Lang.t("direction.north") + " (-Z)";
                default -> Lang.t("direction.east") + " (+X)";
            };
        }
    }

    public static final class Clock extends TextHud {
        private final Setting.Bool seconds = bool("seconds", false);
        private final Setting.Bool twelve = bool("twelve_hour", false);

        public Clock() {
            super("clock", "clock", true, Anchor.TOP_RIGHT);
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            String pattern = (twelve.on() ? "h:mm" : "HH:mm") + (seconds.on() ? ":ss" : "") + (twelve.on() ? " a" : "");
            out.add(line("", LocalTime.now().format(DateTimeFormatter.ofPattern(pattern, java.util.Locale.ENGLISH))));
        }
    }

    public static final class Server extends TextHud {
        public Server() {
            super("server", "server", false, Anchor.TOP_RIGHT);
            order = 1;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            String s = g.server();
            if (s.isEmpty() && !editor) return;
            out.add(line("IP", s.isEmpty() ? "mc.hammershop.pl" : s));
        }
    }

    public static final class Memory extends TextHud {
        private final Setting.Bool details = bool("details", false);

        public Memory() {
            super("memory", "memory", false, Anchor.TOP_RIGHT);
            order = 2;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            Runtime rt = Runtime.getRuntime();
            long used = rt.totalMemory() - rt.freeMemory();
            long max = rt.maxMemory();
            String v = used * 100 / Math.max(1, max) + "%";
            if (details.on()) v += " (" + Fmt.num(used / 1073741824.0, 1) + " / " + Fmt.num(max / 1073741824.0, 1) + " GB)";
            out.add(line("RAM", v));
        }
    }

    public static final class Day extends TextHud {
        public Day() {
            super("day", "day", false, Anchor.TOP_LEFT);
            order = 5;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            out.add(line(hud("day"), String.valueOf(g.dayTime() / 24000L + 1)));
        }
    }

    public static final class Speed extends TextHud {
        private final Setting.Choice unit = choice("unit", 0, "blocks_s", "km_h");

        public Speed() {
            super("speed", "speed", false, Anchor.TOP_LEFT);
            order = 4;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            double s = Hammer.stats().speed();
            out.add(line(hud("speed"), unit.get() == 0 ? Fmt.num(s, 1) + " bl/s" : Fmt.num(s * 3.6, 1) + " km/h"));
        }
    }

    public static final class Combo extends TextHud {
        public Combo() {
            super("combo", "combo", false, Anchor.MIDDLE);
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            int c = Hammer.stats().combo();
            if (c < 2 && !editor) return;
            out.add(line("Combo", String.valueOf(Math.max(c, editor ? 3 : c))));
        }
    }

    public static final class Reach extends TextHud {
        public Reach() {
            super("reach", "reach", false, Anchor.MIDDLE);
            order = 1;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            double r = Hammer.stats().reach();
            if (r < 0 && !editor) return;
            out.add(line(hud("reach"), Fmt.num(r < 0 ? 2.87 : r, 2) + " bl"));
        }
    }

    public static final class Saturation extends TextHud {
        public Saturation() {
            super("saturation", "saturation", false, Anchor.TOP_RIGHT);
            order = 4;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            out.add(line(hud("saturation"), Fmt.num(g.saturation(), 1)));
        }
    }

    public static final class Stopwatch extends TextHud {
        public Stopwatch() {
            super("stopwatch", "stopwatch", false, Anchor.TOP_CENTER);
            order = 1;
        }

        @Override
        public String note() {
            return Lang.t("module.stopwatch.note", Hammer.platform().keyName(Keys.STOPWATCH.id));
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            long ms = Hammer.stats().stopwatchMillis();
            if (ms == 0 && !Hammer.stats().stopwatchRunning() && !editor) return;
            out.add(line(hud("stopwatch"), Fmt.clock(ms / 1000) + "," + (ms % 1000) / 100));
        }
    }

    public static final class Tps extends TextHud {
        public Tps() {
            super("tps", "tps", false, Anchor.TOP_RIGHT);
            order = 3;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            double t = Hammer.stats().tps();
            if (t < 0 && !editor) return;
            out.add(line("TPS", Fmt.num(t < 0 ? 20 : t, 1)));
        }
    }

    public static final class Session extends TextHud {
        public Session() {
            super("session", "session", false, Anchor.TOP_RIGHT);
            order = 5;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            out.add(line(hud("session"), Fmt.clock((System.currentTimeMillis() - Hammer.stats().sessionStart) / 1000)));
        }
    }

    public static final class Light extends TextHud {
        public Light() {
            super("light", "fullbright", false, Anchor.TOP_LEFT);
            order = 6;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            int l = g.light();
            out.add(line(hud("light"), String.valueOf(l)));
        }
    }

    /** Health and armour as numbers (hearts are hard to count in a fight). */
    public static final class Health extends TextHud {
        private final Setting.Bool armor = bool("armor_points", true);

        public Health() {
            super("health", "heart", false, Anchor.BOTTOM_LEFT);
            order = 2;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            float hp = editor && !g.inWorld() ? 17f : g.health();
            float extra = g.absorption();
            out.add(line(hud("health"), Fmt.num(hp, 1) + (extra > 0 ? " + " + Fmt.num(extra, 1) : "") + " / " + Fmt.num(g.maxHealth(), 0)));
            if (armor.on()) out.add(line(hud("armor"), String.valueOf(editor && !g.inWorld() ? 12 : g.armor())));
        }
    }

    /** The block you are looking at. */
    public static final class BlockInfo extends TextHud {
        public BlockInfo() {
            super("blockinfo", "cube", false, Anchor.TOP_CENTER);
            order = 6;
        }

        @Override
        protected void lines(Game g, boolean editor, List<String[]> out) {
            String block = g.block();
            if (block.isEmpty() && editor) block = Lang.t("hud.sample_block");
            if (!block.isEmpty()) out.add(line("", block));
        }
    }
}
