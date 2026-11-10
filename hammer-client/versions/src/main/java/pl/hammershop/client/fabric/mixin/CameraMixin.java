package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.Camera;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import pl.hammershop.client.Hammer;

/** Freelook: the camera looks where the freelook module says, the player keeps facing where they were. */
@Mixin(Camera.class)
public abstract class CameraMixin {
    @ModifyVariable(method = "setRotation", at = @At("HEAD"), argsOnly = true, ordinal = 0)
    private float hammer$yaw(float yaw) {
        return Hammer.freelook() ? Hammer.freelookYaw() : yaw;
    }

    @ModifyVariable(method = "setRotation", at = @At("HEAD"), argsOnly = true, ordinal = 1)
    private float hammer$pitch(float pitch) {
        return Hammer.freelook() ? Hammer.freelookPitch() : pitch;
    }
}
