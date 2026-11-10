package pl.hammershop.client.fabric.mixin;

import org.spongepowered.asm.mixin.Mixin;
//#if MC < 26.1
import net.minecraft.client.multiplayer.ClientLevel;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.fabric.FabricPlatform;
//#endif

/** Time changer: the sky shows the time of day you picked (only on your screen). */
//#if MC >= 26.1
@Mixin(net.minecraft.client.Minecraft.class)
public abstract class TimeMixin {
}
//#else
@Mixin(ClientLevel.ClientLevelData.class)
public abstract class TimeMixin {
    @Inject(method = "getDayTime", at = @At("RETURN"), cancellable = true)
    private void hammer$time(CallbackInfoReturnable<Long> cir) {
        long real = cir.getReturnValueJ();
        FabricPlatform.realDayTime = real;
        long shown = Hammer.dayTime(real);
        if (shown != real) cir.setReturnValue(shown);
    }
}
//#endif
