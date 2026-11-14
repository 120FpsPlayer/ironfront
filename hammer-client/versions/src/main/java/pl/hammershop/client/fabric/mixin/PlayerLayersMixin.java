package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.renderer.entity.EntityRendererProvider;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.fabric.FabricPlatform;
//#if MC >= 1.21.9
import net.minecraft.client.renderer.entity.player.AvatarRenderer;
//#else
import net.minecraft.client.renderer.entity.player.PlayerRenderer;
//#endif

/** Dodatki (Hammer+): the player renderer gets one more layer – wings, halo and hat – next to the cape. */
//#if MC >= 1.21.9
@Mixin(AvatarRenderer.class)
//#else
@Mixin(PlayerRenderer.class)
//#endif
public abstract class PlayerLayersMixin {
    @Inject(method = "<init>", at = @At("TAIL"))
    private void hammer$cosmetics(EntityRendererProvider.Context context, boolean slim, CallbackInfo ci) {
        FabricPlatform.addCosmeticsLayer(this);
    }
}
