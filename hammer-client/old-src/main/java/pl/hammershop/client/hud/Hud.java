package pl.hammershop.client.hud;

import net.minecraft.Util;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import org.lwjgl.glfw.GLFW;
import pl.hammershop.client.HammerClient;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Modules;
import pl.hammershop.client.ui.HudEditorScreen;

import java.util.ArrayDeque;
import java.util.Deque;

/** Draws the enabled HUD modules at their places and counts clicks per second. */
public final class Hud {
    private static final Deque<Long> LEFT = new ArrayDeque<>();
    private static final Deque<Long> RIGHT = new ArrayDeque<>();
    private static boolean wasLeft;
    private static boolean wasRight;

    private Hud() {
    }

    public static void render(GuiGraphics g, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui || mc.getDebugOverlay().showDebugScreen() || mc.screen instanceof HudEditorScreen) return;
        trackClicks(mc);
        draw(g, mc, false);
    }

    /** All enabled HUD modules; the editor calls this too, with sample content. */
    public static void draw(GuiGraphics g, Minecraft mc, boolean editor) {
        float scale = HammerClient.config().hudScale;
        int sw = screenWidth(g);
        int sh = screenHeight(g);
        for (HudModule m : Modules.HUD) {
            if (!m.enabled()) continue;
            g.pose().pushPose();
            g.pose().scale(scale, scale, 1f);
            g.pose().translate(m.left(sw), m.top(sh), 0f);
            m.render(g, mc, editor);
            g.pose().popPose();
        }
    }

    public static int screenWidth(GuiGraphics g) {
        return (int) (g.guiWidth() / HammerClient.config().hudScale);
    }

    public static int screenHeight(GuiGraphics g) {
        return (int) (g.guiHeight() / HammerClient.config().hudScale);
    }

    private static void trackClicks(Minecraft mc) {
        long window = mc.getWindow().getWindow();
        boolean free = mc.screen == null;
        boolean l = free && GLFW.glfwGetMouseButton(window, GLFW.GLFW_MOUSE_BUTTON_LEFT) == GLFW.GLFW_PRESS;
        boolean r = free && GLFW.glfwGetMouseButton(window, GLFW.GLFW_MOUSE_BUTTON_RIGHT) == GLFW.GLFW_PRESS;
        long now = Util.getMillis();
        if (l && !wasLeft) LEFT.addLast(now);
        if (r && !wasRight) RIGHT.addLast(now);
        wasLeft = l;
        wasRight = r;
    }

    private static int count(Deque<Long> clicks) {
        long now = Util.getMillis();
        while (!clicks.isEmpty() && now - clicks.peekFirst() > 1000) clicks.removeFirst();
        return clicks.size();
    }

    public static int cpsLeft() {
        return count(LEFT);
    }

    public static int cpsRight() {
        return count(RIGHT);
    }
}
