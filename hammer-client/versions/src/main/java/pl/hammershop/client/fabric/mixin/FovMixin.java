package pl.hammershop.client.fabric.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import pl.hammershop.client.Hammer;

/** Zoom: the field of view the game works out is narrowed while the zoom key is held. */
//#if MC >= 26.1
@Mixin(net.minecraft.client.Camera.class)
public abstract class FovMixin {
    @Inject(method = "calculateFov", at = @At("RETURN"), cancellable = true)
    private void hammer$fov(float partialTick, CallbackInfoReturnable<Float> cir) {
        cir.setReturnValue((float) Hammer.fov(cir.getReturnValueF()));
    }
}
//#else
@Mixin(net.minecraft.client.renderer.GameRenderer.class)
public abstract class FovMixin {
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    //#if MC >= 1.21.2
    private void hammer$fov(net.minecraft.client.Camera camera, float partialTick, boolean useFovSetting, CallbackInfoReturnable<Float> cir) {
        if (useFovSetting) cir.setReturnValue((float) Hammer.fov(cir.getReturnValueF()));
    }
    //#else
    private void hammer$fov(net.minecraft.client.Camera camera, float partialTick, boolean useFovSetting, CallbackInfoReturnable<Double> cir) {
        if (useFovSetting) cir.setReturnValue(Hammer.fov(cir.getReturnValueD()));
    }
    //#endif
}
//#endif
