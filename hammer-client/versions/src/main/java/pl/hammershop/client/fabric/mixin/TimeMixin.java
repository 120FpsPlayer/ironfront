package pl.hammershop.client.fabric.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import pl.hammershop.client.fabric.FabricPlatform;

/**
 * Time changer: the sky shows the time of day you picked (only on your screen). Up to 1.21.11 the client keeps the
 * time of day in its level data; 26.1 introduced world clocks, read through the client's clock manager.
 */
//#if MC >= 26.3
@Mixin(net.minecraft.client.ClientClockManager.ClientClockInstance.class)
public abstract class TimeMixin {
    @Inject(method = "totalTicks", at = @At("RETURN"), cancellable = true)
    private void hammer$time(CallbackInfoReturnable<Long> cir) {
        long real = cir.getReturnValueJ();
        long shown = FabricPlatform.shownTime(real);
        if (shown != real) cir.setReturnValue(shown);
    }
}
//#elif MC >= 26.1
@Mixin(net.minecraft.client.ClientClockManager.class)
public abstract class TimeMixin {
    @Inject(method = "getTotalTicks", at = @At("RETURN"), cancellable = true)
    private void hammer$time(net.minecraft.core.Holder<net.minecraft.world.clock.WorldClock> clock, CallbackInfoReturnable<Long> cir) {
        long real = cir.getReturnValueJ();
        long shown = FabricPlatform.shownTime(real);
        if (shown != real) cir.setReturnValue(shown);
    }
}
//#else
@Mixin(net.minecraft.client.multiplayer.ClientLevel.ClientLevelData.class)
public abstract class TimeMixin {
    @Inject(method = "getDayTime", at = @At("RETURN"), cancellable = true)
    private void hammer$time(CallbackInfoReturnable<Long> cir) {
        long real = cir.getReturnValueJ();
        long shown = FabricPlatform.shownTime(real);
        if (shown != real) cir.setReturnValue(shown);
    }
}
//#endif
