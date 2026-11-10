package pl.hammershop.client;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import pl.hammershop.client.config.HammerConfig;
import pl.hammershop.client.hud.Hud;
import pl.hammershop.client.module.Modules;
import pl.hammershop.client.ui.HammerButton;
import pl.hammershop.client.ui.ModMenuScreen;
import pl.hammershop.client.ui.Theme;

/**
 * Hammer Client – the in-game side of Hammer Launcher: a custom main menu, a module panel (right Shift), HUD modules
 * with a drag-and-drop editor, zoom and toggle sprint. Only quality-of-life features – nothing that gives an unfair
 * advantage on servers.
 */
public final class HammerClient implements ClientModInitializer {
    public static final String MOD_ID = "hammerclient";
    public static final Logger LOG = LoggerFactory.getLogger("Hammer Client");

    private static HammerConfig config;
    public static KeyMapping menuKey;
    public static KeyMapping zoomKey;

    public static HammerConfig config() {
        if (config == null) config = HammerConfig.load();
        return config;
    }

    public static String version() {
        return FabricLoader.getInstance().getModContainer(MOD_ID).map(c -> c.getMetadata().getVersion().getFriendlyString()).orElse("?");
    }

    @Override
    public void onInitializeClient() {
        config();
        menuKey = KeyBindingHelper.registerKeyBinding(new KeyMapping("key.hammerclient.menu", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_RIGHT_SHIFT, "category.hammerclient"));
        zoomKey = KeyBindingHelper.registerKeyBinding(new KeyMapping("key.hammerclient.zoom", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_C, "category.hammerclient"));

        ClientTickEvents.END_CLIENT_TICK.register(HammerClient::tick);
        HudRenderCallback.EVENT.register(Hud::render);
        ScreenEvents.AFTER_INIT.register(HammerClient::afterScreenInit);
        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> config().save());

        LOG.info("[Hammer Client] Gotowe – wersja {}, menu modułów: prawy Shift", version());
    }

    private static void tick(Minecraft mc) {
        while (menuKey.consumeClick()) {
            if (mc.screen == null) mc.setScreen(new ModMenuScreen(null));
        }
        Modules.tick(mc);
    }

    /** Extra buttons in the pause menu: the module panel and our Discord. */
    private static void afterScreenInit(Minecraft mc, Screen screen, int width, int height) {
        if (!(screen instanceof PauseScreen)) return;
        var buttons = Screens.getButtons(screen);
        buttons.add(new HammerButton(8, 8, 110, 20, Component.translatable("hammerclient.pause.mods"), b -> mc.setScreen(new ModMenuScreen(screen))));
        if (!config().discordUrl.isBlank()) {
            buttons.add(new HammerButton(8, 32, 110, 20, Component.translatable("hammerclient.pause.discord"), b -> Theme.openLink(config().discordUrl)).discord());
        }
    }
}
