package pl.hammershop.client.ui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.network.chat.Component;

/** A HammerShop-style button: dark glass, orange when hovered (or always, for the main action), blue for Discord. */
public class HammerButton extends Button {
    private boolean primary;
    private boolean discord;

    public HammerButton(int x, int y, int width, int height, Component message, OnPress onPress) {
        super(x, y, width, height, message, onPress, DEFAULT_NARRATION);
    }

    public HammerButton primary() {
        primary = true;
        return this;
    }

    public HammerButton primary(boolean on) {
        primary = on;
        return this;
    }

    public HammerButton discord() {
        discord = true;
        return this;
    }

    @Override
    protected void renderWidget(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        Font font = Minecraft.getInstance().font;
        int x = getX();
        int y = getY();
        int w = getWidth();
        int h = getHeight();
        boolean hot = active && isHoveredOrFocused();
        int top;
        int bottom;
        int text;
        if (!active) {
            top = 0x90140F0B;
            bottom = 0x90140F0B;
            text = Theme.DIM;
        } else if (discord) {
            top = hot ? 0xFF8790F7 : 0xFF6670F4;
            bottom = hot ? 0xFF5865F2 : 0xFF4752C4;
            text = 0xFFFFFFFF;
        } else if (primary || hot) {
            top = hot ? 0xFFFFD4A3 : Theme.ACCENT_LIGHT;
            bottom = hot ? Theme.ACCENT : Theme.ACCENT_DARK;
            text = Theme.INK;
        } else {
            top = 0xD8261D15;
            bottom = 0xD81A140F;
            text = Theme.TEXT;
        }
        g.fillGradient(x, y, x + w, y + h, top, bottom);
        Theme.border(g, x, y, w, h, hot ? 0xFFFFE2C2 : primary ? 0x90FFD4A3 : Theme.LINE);
        Component msg = getMessage();
        int tw = font.width(msg);
        boolean dark = text == Theme.INK;
        g.drawString(font, msg, x + (w - tw) / 2, y + (h - 8) / 2, text, !dark);
    }
}
