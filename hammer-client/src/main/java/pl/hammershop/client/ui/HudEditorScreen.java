package pl.hammershop.client.ui;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.jetbrains.annotations.Nullable;
import pl.hammershop.client.HammerClient;
import pl.hammershop.client.hud.Hud;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Modules;

/** Drag the HUD modules where you want them. Positions are kept as shares of the screen, so they fit any size. */
public class HudEditorScreen extends Screen {
    @Nullable
    private final Screen parent;
    @Nullable
    private HudModule dragging;
    private int grabX;
    private int grabY;

    public HudEditorScreen(@Nullable Screen parent) {
        super(Component.translatable("hammerclient.editor.title"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int cx = width / 2;
        int y = height / 2 + 30;
        addRenderableWidget(new HammerButton(cx - 102, y, 100, 20, Component.translatable("hammerclient.editor.reset"), b -> {
            for (HudModule m : Modules.HUD) m.resetPosition();
            HammerClient.config().save();
        }));
        addRenderableWidget(new HammerButton(cx + 2, y, 100, 20, Component.translatable("hammerclient.menu.done"), b -> onClose()).primary());
    }

    private float scale() {
        return HammerClient.config().hudScale;
    }

    private int sw() {
        return (int) (width / scale());
    }

    private int sh() {
        return (int) (height / scale());
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        if (minecraft.level == null) Theme.background(g, width, height);
        else g.fill(0, 0, width, height, 0x60000000);
        g.fill(width / 2, 0, width / 2 + 1, height, 0x30FFC27E);
        g.fill(0, height / 2, width, height / 2 + 1, 0x30FFC27E);
        Component hint = Component.translatable("hammerclient.editor.hint");
        g.drawString(font, hint, (width - font.width(hint)) / 2, height / 2 + 14, Theme.ACCENT_LIGHT, true);
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        Hud.draw(g, minecraft, true);
        float s = scale();
        for (HudModule m : Modules.HUD) {
            if (!m.enabled() || m.width <= 0) continue;
            int x = (int) (m.left(sw()) * s);
            int y = (int) (m.top(sh()) * s);
            int w = (int) (m.width * s);
            int h = (int) (m.height * s);
            boolean hover = m == dragging || (mouseX >= x && mouseX < x + w && mouseY >= y && mouseY < y + h);
            Theme.border(g, x - 1, y - 1, w + 2, h + 2, hover ? 0xFFFFC27E : 0x90FF9F43);
            if (hover) g.drawString(font, m.name(), x, Math.max(0, y - 10), Theme.ACCENT_LIGHT, true);
        }
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (super.mouseClicked(mouseX, mouseY, button)) return true;
        if (button != 0) return false;
        float s = scale();
        int mx = (int) (mouseX / s);
        int my = (int) (mouseY / s);
        for (int i = Modules.HUD.size() - 1; i >= 0; i--) {
            HudModule m = Modules.HUD.get(i);
            if (!m.enabled() || m.width <= 0) continue;
            int x = m.left(sw());
            int y = m.top(sh());
            if (mx >= x && mx < x + m.width && my >= y && my < y + m.height) {
                dragging = m;
                grabX = mx - x;
                grabY = my - y;
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double dragX, double dragY) {
        if (dragging == null) return super.mouseDragged(mouseX, mouseY, button, dragX, dragY);
        float s = scale();
        dragging.moveTo((int) (mouseX / s) - grabX, (int) (mouseY / s) - grabY, sw(), sh());
        return true;
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        if (dragging != null) {
            dragging = null;
            HammerClient.config().save();
            return true;
        }
        return super.mouseReleased(mouseX, mouseY, button);
    }

    @Override
    public void onClose() {
        HammerClient.config().save();
        minecraft.setScreen(parent);
    }
}
