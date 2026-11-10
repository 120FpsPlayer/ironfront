package pl.hammershop.client.ui;

import net.minecraft.SharedConstants;
import net.minecraft.Util;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.network.chat.Component;
import pl.hammershop.client.HammerClient;
import pl.hammershop.client.config.HammerConfig;

/** The Hammer main menu that replaces the vanilla title screen. */
public class HammerTitleScreen extends Screen {
    private static boolean announced;
    private static final int TIPS = 6;
    private int buttonsTop;

    public HammerTitleScreen() {
        super(Component.translatable("hammerclient.title"));
    }

    private static Component t(String key) {
        return Component.translatable("hammerclient.title." + key);
    }

    @Override
    protected void init() {
        if (!announced) {
            announced = true;
            HammerClient.LOG.info("[Hammer Client] Menu główne Hammer otwarte");
        }
        HammerConfig cfg = HammerClient.config();
        int cx = width / 2;
        buttonsTop = Math.max(height / 2 - 14, 92);
        int y = buttonsTop;
        addRenderableWidget(new HammerButton(cx - 100, y, 200, 22, t("singleplayer"), b -> minecraft.setScreen(new SelectWorldScreen(this))).primary());
        y += 26;
        addRenderableWidget(new HammerButton(cx - 100, y, 200, 22, t("multiplayer"), b -> minecraft.setScreen(new JoinMultiplayerScreen(this))));
        y += 26;
        addRenderableWidget(new HammerButton(cx - 100, y, 98, 20, t("options"), b -> minecraft.setScreen(new OptionsScreen(this, minecraft.options))));
        addRenderableWidget(new HammerButton(cx + 2, y, 98, 20, t("mods"), b -> minecraft.setScreen(new ModMenuScreen(this))));
        y += 24;
        HammerButton discord = new HammerButton(cx - 100, y, 64, 20, t("discord"), b -> Theme.openLink(cfg.discordUrl)).discord();
        discord.active = !cfg.discordUrl.isBlank();
        addRenderableWidget(discord);
        HammerButton shop = new HammerButton(cx - 32, y, 64, 20, t("shop"), b -> Theme.openLink(cfg.shopUrl));
        shop.active = !cfg.shopUrl.isBlank();
        addRenderableWidget(shop);
        addRenderableWidget(new HammerButton(cx + 36, y, 64, 20, t("quit"), b -> minecraft.stop()));
    }

    @Override
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        Theme.background(g, width, height);
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int cx = width / 2;

        // Logo and name above the buttons.
        int logo = Math.max(28, Math.min(56, buttonsTop - 46));
        int logoY = Math.max(6, buttonsTop - logo - 34);
        Theme.logo(g, cx - logo / 2, logoY, logo);
        Component name = Component.literal("Hammer ").append(Theme.colored(Component.literal("Client"), Theme.ACCENT));
        g.pose().pushPose();
        g.pose().translate(cx, logoY + logo + 6, 0f);
        g.pose().scale(2f, 2f, 1f);
        g.drawString(font, name, -font.width(name) / 2, 0, Theme.TEXT, true);
        g.pose().popPose();
        Component by = Theme.colored(Component.translatable("hammerclient.title.by", HammerClient.config().brand), Theme.DIM);
        g.drawString(font, by, cx - font.width(by) / 2, logoY + logo + 26, Theme.DIM, false);

        // Tip of the moment.
        int tip = (int) ((Util.getMillis() / 8000L) % TIPS);
        Component tipText = Component.translatable("hammerclient.tip." + tip);
        int tipY = buttonsTop + 26 * 2 + 24 * 2 + 10;
        if (tipY < height - 26) g.drawString(font, tipText, cx - font.width(tipText) / 2, tipY, Theme.MUTED, false);

        // Account top-right, version and Mojang notice at the bottom.
        Component user = Component.translatable("hammerclient.title.welcome", minecraft.getUser().getName());
        g.drawString(font, user, width - font.width(user) - 6, 6, Theme.MUTED, true);
        String version = "Hammer Client " + HammerClient.version() + " · Minecraft " + SharedConstants.getCurrentVersion().getName();
        g.drawString(font, version, 4, height - 11, Theme.DIM, false);
        Component credits = Component.translatable("title.credits");
        g.drawString(font, credits, width - font.width(credits) - 4, height - 11, Theme.DIM, false);
    }

    @Override
    public boolean shouldCloseOnEsc() {
        return false;
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
