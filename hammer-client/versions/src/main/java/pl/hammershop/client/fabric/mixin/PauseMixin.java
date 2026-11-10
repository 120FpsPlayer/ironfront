package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.PauseScreen;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.fabric.FabricPlatform;

/** Adds the Hammer buttons to the pause menu. */
@Mixin(PauseScreen.class)
public abstract class PauseMixin {
    @Shadow
    @Final
    private boolean showPauseMenu;

    //#if MC >= 26.1
    @Inject(method = "extractRenderState", at = @At("TAIL"))
    //#else
    @Inject(method = "render", at = @At("TAIL"))
    //#endif
    private void hammer$pause(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
        if (showPauseMenu) FabricPlatform.pauseOverlay(graphics);
    }
}
