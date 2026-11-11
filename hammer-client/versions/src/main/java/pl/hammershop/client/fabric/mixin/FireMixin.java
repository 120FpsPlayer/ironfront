package pl.hammershop.client.fabric.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.renderer.ScreenEffectRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.Hammer;

/** Low fire: the flames drawn over the screen while the player burns are moved down, out of the way. */
@Mixin(ScreenEffectRenderer.class)
public abstract class FireMixin {
    @Unique
    private static PoseStack hammer$moved;

    //#if MC >= 26.2
    @ModifyVariable(method = "submitFire", at = @At("HEAD"), argsOnly = true)
    //#else
    @ModifyVariable(method = "renderFire", at = @At("HEAD"), argsOnly = true)
    //#endif
    private static PoseStack hammer$lower(PoseStack stack) {
        float down = Hammer.lowFire();
        if (down > 0f && stack != null) {
            stack.pushPose();
            stack.translate(0f, -down, 0f);
            hammer$moved = stack;
        }
        return stack;
    }

    //#if MC >= 26.2
    @Inject(method = "submitFire", at = @At("RETURN"))
    //#else
    @Inject(method = "renderFire", at = @At("RETURN"))
    //#endif
    private static void hammer$restore(CallbackInfo ci) {
        if (hammer$moved != null) {
            hammer$moved.popPose();
            hammer$moved = null;
        }
    }
}
