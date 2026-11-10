package pl.hammershop.client.ui;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Mth;
import org.jetbrains.annotations.Nullable;
import pl.hammershop.client.HammerClient;
import pl.hammershop.client.config.HammerConfig;
import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Modules;

import java.util.ArrayList;
import java.util.List;

/** The module panel (right Shift): cards to switch modules on and off, HUD editor, scale and menu options. */
public class ModMenuScreen extends Screen {
    private static final int CARD_H = 42;
    private static final int GAP = 6;
    private static final float[] SCALES = {0.75f, 1.0f, 1.25f, 1.5f};

    @Nullable
    private final Screen parent;
    private String tab = "all";
    private double scroll;
    private int px;
    private int py;
    private int pw;
    private int ph;

    public ModMenuScreen(@Nullable Screen parent) {
        super(Component.translatable("hammerclient.menu.title"));
        this.parent = parent;
    }

    private static Component t(String key, Object... args) {
        return Component.translatable("hammerclient.menu." + key, args);
    }

    @Override
    protected void init() {
        HammerConfig cfg = HammerClient.config();
        pw = Math.min(460, width - 20);
        ph = Math.min(290, height - 20);
        px = (width - pw) / 2;
        py = (height - ph) / 2;

        int tx = px + 12;
        for (String id : new String[] {"all", "hud", "gameplay"}) {
            Component label = id.equals("all") ? t("all") : Component.translatable("hammerclient.category." + id);
            int w = font.width(label) + 16;
            String tabId = id;
            addRenderableWidget(new HammerButton(tx, py + 30, w, 16, label, b -> {
                tab = tabId;
                scroll = 0;
                rebuildWidgets();
            }).primary(tab.equals(id)));
            tx += w + 4;
        }
        if (!cfg.discordUrl.isBlank()) addRenderableWidget(new HammerButton(px + pw - 76, py + 8, 64, 16, Component.translatable("hammerclient.title.discord"), b -> Theme.openLink(cfg.discordUrl)).discord());

        int by = py + ph - 26;
        int bw = (pw - 24 - 3 * 4) / 4;
        int bx = px + 12;
        addRenderableWidget(new HammerButton(bx, by, bw, 18, t("edit_hud"), b -> minecraft.setScreen(new HudEditorScreen(this))));
        bx += bw + 4;
        addRenderableWidget(new HammerButton(bx, by, bw, 18, t("scale", Math.round(cfg.hudScale * 100)), b -> {
            int i = 0;
            while (i < SCALES.length && Math.abs(SCALES[i] - cfg.hudScale) > 0.01f) i++;
            cfg.hudScale = SCALES[(i + 1) % SCALES.length];
            cfg.save();
            rebuildWidgets();
        }));
        bx += bw + 4;
        addRenderableWidget(new HammerButton(bx, by, bw, 18, t("custom_menu", onOff(cfg.customMenu)), b -> {
            cfg.customMenu = !cfg.customMenu;
            cfg.save();
            rebuildWidgets();
        }));
        bx += bw + 4;
        addRenderableWidget(new HammerButton(bx, by, bw, 18, t("done"), b -> onClose()).primary());
    }

    private static Component onOff(boolean on) {
        return Component.translatable(on ? "hammerclient.on" : "hammerclient.off");
    }

    private List<Module> visible() {
        List<Module> list = new ArrayList<>();
        for (Module m : Modules.ALL) if (tab.equals("all") || m.category.key.equals(tab)) list.add(m);
        return list;
    }

    // Card grid geometry.
    private int gridX() {
        return px + 12;
    }

    private int gridY() {
        return py + 54;
    }

    private int gridW() {
        return pw - 24;
    }

    private int gridH() {
        return ph - 54 - 32;
    }

    private int cols() {
        return Math.max(1, (gridW() + GAP) / (132 + GAP));
    }

    private int cardW() {
        return (gridW() - GAP * (cols() - 1)) / cols();
    }

    private int maxScroll() {
        int rows = (visible().size() + cols() - 1) / cols();
        return Math.max(0, rows * (CARD_H + GAP) - GAP - gridH());
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        if (minecraft.level != null) super.renderBackground(g, mouseX, mouseY, partialTick);
        else Theme.background(g, width, height);
        Theme.panel(g, px, py, pw, ph);
        Theme.logo(g, px + 10, py + 7, 18);
        g.drawString(font, Theme.colored(Component.literal("HAMMER CLIENT"), Theme.ACCENT), px + 33, py + 9, Theme.ACCENT, true);
        g.drawString(font, t("subtitle"), px + 33, py + 19, Theme.DIM, false);

        List<Module> list = visible();
        int cols = cols();
        int cw = cardW();
        int gx = gridX();
        int gy = gridY();
        g.enableScissor(gx, gy, gx + gridW(), gy + gridH());
        for (int i = 0; i < list.size(); i++) {
            Module m = list.get(i);
            int x = gx + (i % cols) * (cw + GAP);
            int y = gy + (i / cols) * (CARD_H + GAP) - (int) scroll;
            if (y + CARD_H < gy || y > gy + gridH()) continue;
            boolean hover = mouseX >= x && mouseX < x + cw && mouseY >= y && mouseY < y + CARD_H && mouseY >= gy && mouseY < gy + gridH();
            boolean on = m.enabled();
            g.fill(x, y, x + cw, y + CARD_H, hover ? 0xF030241A : Theme.PANEL_LIGHT);
            Theme.border(g, x, y, cw, CARD_H, on ? 0xC0FF9F43 : Theme.LINE);
            if (on) g.fill(x, y, x + 2, y + CARD_H, Theme.ACCENT);
            g.drawString(font, m.name(), x + 8, y + 6, Theme.TEXT, true);
            Component pill = onOff(on);
            int pwid = font.width(pill) + 8;
            g.fill(x + cw - pwid - 6, y + 5, x + cw - 6, y + 16, on ? 0xFF2F7A4A : 0xFF3A2E24);
            g.drawString(font, pill, x + cw - pwid - 2, y + 7, on ? 0xFFD8FFE6 : Theme.MUTED, false);
            List<FormattedCharSequence> lines = font.split(m.description(), cw - 14);
            for (int l = 0; l < Math.min(2, lines.size()); l++) g.drawString(font, lines.get(l), x + 8, y + 19 + l * 10, Theme.DIM, false);
        }
        g.disableScissor();
        if (maxScroll() > 0) {
            int track = gridH();
            int thumb = Math.max(16, track * track / (track + maxScroll()));
            int ty = gy + (int) ((track - thumb) * (scroll / maxScroll()));
            g.fill(px + pw - 7, ty, px + pw - 4, ty + thumb, 0x80FFC27E);
        }
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (super.mouseClicked(mouseX, mouseY, button)) return true;
        if (button != 0) return false;
        int gx = gridX();
        int gy = gridY();
        if (mouseX < gx || mouseX >= gx + gridW() || mouseY < gy || mouseY >= gy + gridH()) return false;
        int cw = cardW();
        int col = (int) ((mouseX - gx) / (cw + GAP));
        int row = (int) ((mouseY - gy + scroll) / (CARD_H + GAP));
        if (col >= cols() || (mouseX - gx) - col * (cw + GAP) > cw || (mouseY - gy + scroll) - row * (CARD_H + GAP) > CARD_H) return false;
        int index = row * cols() + col;
        List<Module> list = visible();
        if (index < 0 || index >= list.size()) return false;
        list.get(index).toggle();
        minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0F));
        return true;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        scroll = Mth.clamp(scroll - scrollY * 24, 0, maxScroll());
        return true;
    }

    @Override
    public void onClose() {
        HammerClient.config().save();
        minecraft.setScreen(parent);
    }
}
