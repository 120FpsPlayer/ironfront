package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.player.AbstractClientPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import pl.hammershop.client.fabric.FabricPlatform;
//#if MC >= 1.21.9
import net.minecraft.world.entity.player.PlayerSkin;
//#else
import net.minecraft.client.resources.PlayerSkin;
//#endif

/** Hammer capes: a player with one is drawn with it instead of their own cape. */
@Mixin(AbstractClientPlayer.class)
public abstract class CapeMixin {
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true)
    private void hammer$cape(CallbackInfoReturnable<PlayerSkin> cir) {
        PlayerSkin skin = FabricPlatform.cape((AbstractClientPlayer) (Object) this, cir.getReturnValue());
        if (skin != null) cir.setReturnValue(skin);
    }
}
