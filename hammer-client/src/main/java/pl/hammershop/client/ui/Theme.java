package pl.hammershop.client.ui;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.Util;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.TextColor;
import net.minecraft.resources.ResourceLocation;
import pl.hammershop.client.HammerClient;

import java.util.ArrayList;
import java.util.List;

/** HammerShop look inside the game: warm dark panels, light-orange accent. */
public final class Theme {
    public static final int ACCENT = 0xFFFF9F43;
    public static final int ACCENT_LIGHT = 0xFFFFC27E;
    public static final int ACCENT_DARK = 0xFFF07A1C;
    public static final int INK = 0xFF2A1405;
    public static final int TEXT = 0xFFF7EFE7;
    public static final int MUTED = 0xFFB9A797;
    public static final int DIM = 0xFF85725F;
    public static final int PANEL = 0xE81A140F;
    public static final int PANEL_LIGHT = 0xF0261D15;
    public static final int LINE = 0x40FFC48C;
    public static final int HUD_BG = 0x6E000000;
    public static final int OK = 0xFF5EE08D;
    public static final int ERR = 0xFFFF7A7A;
    public static final int WARN = 0xFFFFC857;
    public static final int DISCORD = 0xFF5865F2;

    public static final ResourceLocation LOGO = ResourceLocation.fromNamespaceAndPath(HammerClient.MOD_ID, "textures/gui/logo.png");
    public static final ResourceLocation BACKGROUND = ResourceLocation.fromNamespaceAndPath(HammerClient.MOD_ID, "textures/gui/background.png");
    private static final int BG_W = 1280;
    private static final int BG_H = 720;

    private Theme() {
    }

    public static MutableComponent colored(Component c, int rgb) {
        return c.copy().withStyle(s -> s.withColor(TextColor.fromRgb(rgb & 0xFFFFFF)));
    }

    public static void border(GuiGraphics g, int x, int y, int w, int h, int color) {
        g.fill(x, y, x + w, y + 1, color);
        g.fill(x, y + h - 1, x + w, y + h, color);
        g.fill(x, y + 1, x + 1, y + h - 1, color);
        g.fill(x + w - 1, y + 1, x + w, y + h - 1, color);
    }

    public static void panel(GuiGraphics g, int x, int y, int w, int h) {
        g.fill(x, y, x + w, y + h, PANEL);
        border(g, x, y, w, h, LINE);
        g.fill(x + 1, y + 1, x + w - 1, y + 2, 0x30FFC27E);
    }

    /** The menu background: the picture cropped to cover the screen, a warm shade and slowly rising sparks. */
    public static void background(GuiGraphics g, int w, int h) {
        float screen = (float) w / Math.max(1, h);
        float tex = (float) BG_W / BG_H;
        int uW = BG_W;
        int vH = BG_H;
        if (screen > tex) vH = Math.round(BG_W / screen);
        else uW = Math.round(BG_H * screen);
        g.blit(BACKGROUND, 0, 0, w, h, (BG_W - uW) / 2f, (BG_H - vH) / 2f, uW, vH, BG_W, BG_H);
        g.fillGradient(0, 0, w, h, 0x50000000, 0xB0100A06);
        embers(g, w, h);
    }

    public static void embers(GuiGraphics g, int w, int h) {
        long t = Util.getMillis();
        for (int i = 0; i < 34; i++) {
            long seed = (i * 2654435761L) & 0xFFFFFFL;
            int speed = 18 + (int) (seed % 23);
            int travel = h + 30;
            int y = h + 10 - (int) ((t / speed + seed * 7) % travel);
            int x = (int) ((seed * 31) % Math.max(1, w)) + (int) (Math.sin(t / 900.0 + i) * 6);
            int size = 1 + (int) (seed % 2);
            float life = 1f - (float) (h + 10 - y) / travel;
            int alpha = (int) (40 + 150 * life) & 0xFF;
            g.fill(x, y, x + size, y + size, (alpha << 24) | (i % 3 == 0 ? 0xFFC27E : 0xFF9F43));
        }
    }

    public static void logo(GuiGraphics g, int x, int y, int size) {
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        g.blit(LOGO, x, y, size, size, 0f, 0f, 256, 256, 256, 256);
        RenderSystem.disableBlend();
    }

    public static void openLink(String url) {
        if (url != null && url.startsWith("https://")) Util.getPlatform().openUri(url);
    }

    /** A HUD text box: label in orange, value in white. */
    public static final class Lines {
        private final List<Component> lines = new ArrayList<>();

        public Lines add(Component label, String value) {
            lines.add(colored(label, ACCENT).append(Component.literal(" " + value).withStyle(s -> s.withColor(TextColor.fromRgb(TEXT & 0xFFFFFF)))));
            return this;
        }

        public Lines add(Component line) {
            lines.add(line);
            return this;
        }

        public boolean isEmpty() {
            return lines.isEmpty();
        }

        public int[] draw(GuiGraphics g, Font font) {
            if (lines.isEmpty()) return new int[] {0, 0};
            int w = 0;
            for (Component c : lines) w = Math.max(w, font.width(c));
            w += 8;
            int h = lines.size() * 10 + 4;
            g.fill(0, 0, w, h, HUD_BG);
            int y = 3;
            for (Component c : lines) {
                g.drawString(font, c, 4, y, TEXT, true);
                y += 10;
            }
            return new int[] {w, h};
        }
    }
}
