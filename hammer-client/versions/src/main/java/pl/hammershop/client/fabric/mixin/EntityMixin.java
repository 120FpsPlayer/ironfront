package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.Hammer;

/** Freelook: mouse movement turns the camera instead of the player. */
@Mixin(Entity.class)
public abstract class EntityMixin {
    @Inject(method = "turn", at = @At("HEAD"), cancellable = true)
    private void hammer$turn(double dx, double dy, CallbackInfo ci) {
        if ((Object) this instanceof LocalPlayer && Hammer.freelook()) {
            Hammer.freelookTurn(dx, dy);
            ci.cancel();
        }
    }
}
