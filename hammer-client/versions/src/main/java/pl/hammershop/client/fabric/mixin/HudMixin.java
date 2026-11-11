package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.fabric.FabricPlatform;

/** Our HUD is drawn after the game's own; the vanilla crosshair steps aside for the custom one; the pumpkin and vignette overlays can be switched off. */
//#if MC >= 26.2
@Mixin(net.minecraft.client.gui.Hud.class)
//#else
@Mixin(net.minecraft.client.gui.Gui.class)
//#endif
public abstract class HudMixin {
    //#if MC >= 26.1
    @Inject(method = "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;Lnet/minecraft/client/DeltaTracker;)V", at = @At("TAIL"))
    //#else
    @Inject(method = "render", at = @At("TAIL"))
    //#endif
    private void hammer$hud(GuiGraphicsExtractor graphics, DeltaTracker delta, CallbackInfo ci) {
        FabricPlatform.hud(graphics);
    }

    //#if MC >= 26.1
    @Inject(method = "extractCrosshair", at = @At("HEAD"), cancellable = true)
    //#else
    @Inject(method = "renderCrosshair", at = @At("HEAD"), cancellable = true)
    //#endif
    private void hammer$crosshair(GuiGraphicsExtractor graphics, DeltaTracker delta, CallbackInfo ci) {
        if (Hammer.hideVanillaCrosshair()) ci.cancel();
    }

    //#if MC >= 26.1
    @Inject(method = "extractTextureOverlay", at = @At("HEAD"), cancellable = true)
    //#else
    @Inject(method = "renderTextureOverlay", at = @At("HEAD"), cancellable = true)
    //#endif
    private void hammer$pumpkin(GuiGraphicsExtractor graphics, Identifier texture, float alpha, CallbackInfo ci) {
        if (texture != null && texture.getPath().contains("pumpkinblur") && Hammer.hidePumpkin()) ci.cancel();
    }

    //#if MC >= 26.1
    @Inject(method = "extractVignette", at = @At("HEAD"), cancellable = true)
    //#else
    @Inject(method = "renderVignette", at = @At("HEAD"), cancellable = true)
    //#endif
    private void hammer$vignette(GuiGraphicsExtractor graphics, Entity entity, CallbackInfo ci) {
        if (Hammer.hideVignette()) ci.cancel();
    }
}
