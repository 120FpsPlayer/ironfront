package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import pl.hammershop.client.fabric.FabricPlatform;

/** Every screen change passes here: the vanilla title screen is replaced by the Hammer main menu. */
//#if MC >= 26.2
@Mixin(net.minecraft.client.gui.Gui.class)
//#else
@Mixin(net.minecraft.client.Minecraft.class)
//#endif
public abstract class ScreenSwapMixin {
    @ModifyVariable(method = "setScreen", at = @At("HEAD"), argsOnly = true)
    private Screen hammer$swap(Screen screen) {
        return FabricPlatform.swap(screen);
    }
}
