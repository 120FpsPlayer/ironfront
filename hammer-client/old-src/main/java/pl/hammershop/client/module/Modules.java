package pl.hammershop.client.module;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import pl.hammershop.client.hud.Hud;
import pl.hammershop.client.ui.Theme;
import pl.hammershop.client.ui.Theme.Lines;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/** Every module of Hammer Client. HUD positions: share of the free space (0 = left/top, 1 = right/bottom). */
public final class Modules {
    public static final List<Module> ALL = new ArrayList<>();
    public static final List<HudModule> HUD = new ArrayList<>();
    private static final Locale PL = Locale.forLanguageTag("pl-PL");

    static {
        add(new Fps());
        add(new Cps());
        add(new Ping());
        add(new Coords());
        add(new Speed());
        add(new Keystrokes());
        add(new Clock());
        add(new ServerInfo());
        add(new Memory());
        add(new Potions());
        add(new Armor());
        add(new DayCounter());
        add(new Zoom());
        add(new ToggleSprint());
    }

    private Modules() {
    }

    private static void add(Module m) {
        ALL.add(m);
        if (m instanceof HudModule h) HUD.add(h);
    }

    public static void tick(Minecraft mc) {
        for (Module m : ALL) m.tick(mc);
    }

    private static Component t(String key) {
        return Component.translatable("hammerclient.hud." + key);
    }

    private static final int[] NOTHING = {0, 0};

    // ───────────── HUD ─────────────

    static final class Fps extends HudModule {
        Fps() {
            super("fps", true, 0f, 0f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            return new Lines().add(t("fps"), String.valueOf(mc.getFps())).draw(g, mc.font);
        }
    }

    static final class Cps extends HudModule {
        Cps() {
            super("cps", true, 0f, 0.075f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            return new Lines().add(t("cps"), Hud.cpsLeft() + " | " + Hud.cpsRight()).draw(g, mc.font);
        }
    }

    static final class Ping extends HudModule {
        Ping() {
            super("ping", true, 0f, 0.15f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            int ms = -1;
            if (mc.getConnection() != null && mc.player != null && !mc.hasSingleplayerServer()) {
                PlayerInfo info = mc.getConnection().getPlayerInfo(mc.player.getUUID());
                if (info != null) ms = info.getLatency();
            }
            if (ms < 0 && !editor) return NOTHING;
            return new Lines().add(t("ping"), (ms < 0 ? 23 : ms) + " ms").draw(g, mc.font);
        }
    }

    static final class Coords extends HudModule {
        Coords() {
            super("coords", true, 0f, 0.225f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            if (mc.player == null || mc.level == null) return NOTHING;
            BlockPos pos = mc.player.blockPosition();
            Component biome = mc.level.getBiome(pos).unwrapKey().map(k -> (Component) Component.translatable("biome." + k.location().getNamespace() + "." + k.location().getPath())).orElse(Component.literal("?"));
            return new Lines()
                    .add(Component.literal("XYZ"), pos.getX() + " " + pos.getY() + " " + pos.getZ())
                    .add(t("facing"), Component.translatable("hammerclient.direction." + mc.player.getDirection().getName()).getString())
                    .add(t("biome"), biome.getString())
                    .draw(g, mc.font);
        }
    }

    static final class Speed extends HudModule {
        private double lastX;
        private double lastZ;
        private double speed;

        Speed() {
            super("speed", false, 0f, 0.36f);
        }

        @Override
        public void tick(Minecraft mc) {
            if (mc.player == null) return;
            double dx = mc.player.getX() - lastX;
            double dz = mc.player.getZ() - lastZ;
            lastX = mc.player.getX();
            lastZ = mc.player.getZ();
            double now = Math.sqrt(dx * dx + dz * dz) * 20.0;
            speed = now > 200 ? 0 : speed * 0.6 + now * 0.4; // teleports don't count
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            return new Lines().add(t("speed"), String.format(PL, "%.1f bl/s", speed)).draw(g, mc.font);
        }
    }

    static final class Clock extends HudModule {
        private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");

        Clock() {
            super("clock", true, 1f, 0f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            return new Lines().add(t("clock"), LocalTime.now().format(HM)).draw(g, mc.font);
        }
    }

    static final class ServerInfo extends HudModule {
        ServerInfo() {
            super("server", false, 1f, 0.075f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            ServerData server = mc.getCurrentServer();
            if (server == null && !editor) return NOTHING;
            return new Lines().add(t("server"), server == null ? "mc.hammershop.pl" : server.ip).draw(g, mc.font);
        }
    }

    static final class Memory extends HudModule {
        Memory() {
            super("memory", false, 1f, 0.15f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            Runtime rt = Runtime.getRuntime();
            long used = rt.totalMemory() - rt.freeMemory();
            long max = rt.maxMemory();
            int pct = (int) (used * 100 / Math.max(1, max));
            return new Lines().add(t("memory"), String.format(PL, "%d%% (%.1f / %.1f GB)", pct, used / 1073741824.0, max / 1073741824.0)).draw(g, mc.font);
        }
    }

    static final class DayCounter extends HudModule {
        DayCounter() {
            super("day", false, 0f, 0.44f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            if (mc.level == null) return NOTHING;
            return new Lines().add(t("day"), String.valueOf(mc.level.getDayTime() / 24000L + 1)).draw(g, mc.font);
        }
    }

    /** Effects with time left, each with its colour. */
    static final class Potions extends HudModule {
        Potions() {
            super("potions", true, 1f, 0.3f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            if (mc.player == null) return NOTHING;
            Font font = mc.font;
            Collection<MobEffectInstance> effects = mc.player.getActiveEffects();
            List<Component> names = new ArrayList<>();
            List<String> times = new ArrayList<>();
            List<Integer> colors = new ArrayList<>();
            for (MobEffectInstance e : effects) {
                Component name = e.getEffect().value().getDisplayName().copy().append(e.getAmplifier() > 0 ? " " + roman(e.getAmplifier() + 1) : "");
                names.add(name);
                times.add(e.isInfiniteDuration() ? "∞" : time(e.getDuration()));
                colors.add(e.getEffect().value().getColor());
            }
            if (names.isEmpty()) {
                if (!editor) return NOTHING;
                names.add(Component.translatable("effect.minecraft.speed").copy().append(" II"));
                times.add("1:30");
                colors.add(0x33EBFF);
            }
            int w = 0;
            for (int i = 0; i < names.size(); i++) w = Math.max(w, font.width(names.get(i)) + font.width(times.get(i)) + 10);
            w += 16;
            int h = names.size() * 11 + 4;
            g.fill(0, 0, w, h, Theme.HUD_BG);
            for (int i = 0; i < names.size(); i++) {
                int y = 3 + i * 11;
                g.fill(4, y + 1, 10, y + 7, 0xFF000000 | colors.get(i));
                g.drawString(font, names.get(i), 14, y, Theme.TEXT, true);
                g.drawString(font, times.get(i), w - 4 - font.width(times.get(i)), y, Theme.ACCENT_LIGHT, true);
            }
            return new int[] {w, h};
        }

        private static String time(int ticks) {
            int s = ticks / 20;
            return s / 60 + ":" + String.format("%02d", s % 60);
        }

        private static String roman(int n) {
            String[] r = {"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"};
            return n >= 0 && n < r.length ? r[n] : String.valueOf(n);
        }
    }

    /** Armour and the held item with durability left. */
    static final class Armor extends HudModule {
        private static final EquipmentSlot[] SLOTS = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET, EquipmentSlot.MAINHAND};

        Armor() {
            super("armor", true, 1f, 1f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            if (mc.player == null) return NOTHING;
            List<ItemStack> items = new ArrayList<>();
            for (EquipmentSlot slot : SLOTS) {
                ItemStack s = mc.player.getItemBySlot(slot);
                if (!s.isEmpty() && (slot != EquipmentSlot.MAINHAND || s.isDamageableItem())) items.add(s);
            }
            if (items.isEmpty()) {
                if (!editor) return NOTHING;
                items.add(new ItemStack(Items.DIAMOND_HELMET));
                items.add(new ItemStack(Items.DIAMOND_CHESTPLATE));
            }
            int w = 22;
            for (ItemStack s : items) if (s.isDamageableItem()) w = Math.max(w, 22 + mc.font.width(String.valueOf(s.getMaxDamage() - s.getDamageValue())) + 4);
            int h = items.size() * 18 + 2;
            g.fill(0, 0, w, h, Theme.HUD_BG);
            int y = 1;
            for (ItemStack s : items) {
                g.renderItem(s, 2, y);
                if (s.isDamageableItem()) {
                    int left = s.getMaxDamage() - s.getDamageValue();
                    float share = (float) left / Math.max(1, s.getMaxDamage());
                    int color = share > 0.5f ? Theme.OK : share > 0.2f ? Theme.WARN : Theme.ERR;
                    g.drawString(mc.font, String.valueOf(left), 21, y + 5, color, true);
                } else if (s.getCount() > 1) {
                    g.drawString(mc.font, "×" + s.getCount(), 21, y + 5, Theme.TEXT, true);
                }
                y += 18;
            }
            return new int[] {w, h};
        }
    }

    /** W A S D, mouse buttons with CPS and the space bar – lit while pressed. */
    static final class Keystrokes extends HudModule {
        private static final int K = 20;
        private static final int GAP = 2;

        Keystrokes() {
            super("keystrokes", true, 0f, 0.62f);
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            int w = K * 3 + GAP * 2;
            key(g, mc, mc.options.keyUp, K + GAP, 0, K, K, null);
            key(g, mc, mc.options.keyLeft, 0, K + GAP, K, K, null);
            key(g, mc, mc.options.keyDown, K + GAP, K + GAP, K, K, null);
            key(g, mc, mc.options.keyRight, (K + GAP) * 2, K + GAP, K, K, null);
            int half = (w - GAP) / 2;
            int row3 = (K + GAP) * 2;
            key(g, mc, mc.options.keyAttack, 0, row3, half, K, Component.translatable("hammerclient.hud.lmb").getString() + " " + Hud.cpsLeft());
            key(g, mc, mc.options.keyUse, half + GAP, row3, w - half - GAP, K, Component.translatable("hammerclient.hud.rmb").getString() + " " + Hud.cpsRight());
            int row4 = row3 + K + GAP;
            boolean jump = mc.options.keyJump.isDown();
            g.fill(0, row4, w, row4 + 10, jump ? 0xD0FF9F43 : Theme.HUD_BG);
            g.fill(w / 2 - 12, row4 + 4, w / 2 + 12, row4 + 5, jump ? Theme.INK : 0xFFDDDDDD);
            return new int[] {w, row4 + 10};
        }

        private static void key(GuiGraphics g, Minecraft mc, KeyMapping key, int x, int y, int w, int h, String label) {
            boolean down = key.isDown();
            g.fill(x, y, x + w, y + h, down ? 0xD0FF9F43 : Theme.HUD_BG);
            String text = label != null ? label : key.getTranslatedKeyMessage().getString();
            if (text.length() > 6) text = text.substring(0, 6);
            int tw = mc.font.width(text);
            g.drawString(mc.font, text, x + (w - tw) / 2, y + (h - 8) / 2, down ? Theme.INK : Theme.TEXT, !down);
        }
    }

    // ───────────── gameplay ─────────────

    /** Vanilla's own "Sprint: toggle" option, switched from the panel, with a small indicator on the HUD. */
    static final class ToggleSprint extends HudModule {
        private boolean synced;

        ToggleSprint() {
            super("togglesprint", Category.GAMEPLAY, false, 0f, 0.52f);
        }

        @Override
        public void tick(Minecraft mc) {
            if (!synced && mc.options != null) {
                synced = true;
                if (enabled() && !mc.options.toggleSprint().get()) mc.options.toggleSprint().set(true);
            }
        }

        @Override
        protected void onToggle(Minecraft mc, boolean on) {
            mc.options.toggleSprint().set(on);
            mc.options.save();
        }

        @Override
        protected int[] draw(GuiGraphics g, Minecraft mc, boolean editor) {
            boolean sprinting = mc.options.keySprint.isDown() || (mc.player != null && mc.player.isSprinting());
            if (!sprinting && !editor) return NOTHING;
            return new Lines().add(Theme.colored(Component.translatable("hammerclient.hud.sprinting"), Theme.ACCENT)).draw(g, mc.font);
        }
    }

    static int clamp(int v, int min, int max) {
        return Mth.clamp(v, min, max);
    }
}
