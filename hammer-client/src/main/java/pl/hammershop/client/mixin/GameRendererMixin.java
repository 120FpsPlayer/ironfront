package pl.hammershop.client.mixin;

import net.minecraft.client.Camera;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import pl.hammershop.client.module.Zoom;

/** Zoom: narrows the field of view while the zoom key is held. */
@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    private void hammerclient$zoom(Camera camera, float partialTick, boolean useFovSetting, CallbackInfoReturnable<Double> cir) {
        double factor = Zoom.fovMultiplier(partialTick);
        if (factor < 0.999) cir.setReturnValue(cir.getReturnValueD() * factor);
    }
}
