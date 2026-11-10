package pl.hammershop.client.mixin;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import pl.hammershop.client.HammerClient;
import pl.hammershop.client.ui.HammerTitleScreen;

/** Swaps the vanilla title screen for the Hammer main menu wherever the game opens it (start, disconnect, quit). */
@Mixin(Minecraft.class)
public abstract class MinecraftMixin {
    @ModifyVariable(method = "setScreen", at = @At("HEAD"), argsOnly = true)
    private Screen hammerclient$titleScreen(Screen screen) {
        if (screen instanceof TitleScreen && HammerClient.config().customMenu) return new HammerTitleScreen();
        return screen;
    }
}
