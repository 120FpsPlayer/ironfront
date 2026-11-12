package pl.hammershop.client.fabric.mixin;

import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import pl.hammershop.client.fabric.FabricPlatform;

/** Clear weather: no rain or thunder on your screen (the server's weather is untouched). */
@Mixin(Level.class)
public abstract class WeatherMixin {
    @Inject(method = "getRainLevel", at = @At("HEAD"), cancellable = true)
    private void hammer$rain(float partialTick, CallbackInfoReturnable<Float> cir) {
        if (((Level) (Object) this).isClientSide() && FabricPlatform.hideWeather()) cir.setReturnValue(0f);
    }

    @Inject(method = "getThunderLevel", at = @At("HEAD"), cancellable = true)
    private void hammer$thunder(float partialTick, CallbackInfoReturnable<Float> cir) {
        if (((Level) (Object) this).isClientSide() && FabricPlatform.hideWeather()) cir.setReturnValue(0f);
    }
}
