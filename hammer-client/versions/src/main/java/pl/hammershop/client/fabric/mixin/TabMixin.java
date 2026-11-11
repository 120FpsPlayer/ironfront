package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.PlayerInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.fabric.FabricPlatform;

/** The player list (Tab): the ping of every player as a number instead of the signal bars. */
@Mixin(PlayerTabOverlay.class)
public abstract class TabMixin {
    //#if MC >= 26.1
    @Inject(method = "extractPingIcon", at = @At("HEAD"), cancellable = true)
    //#else
    @Inject(method = "renderPingIcon", at = @At("HEAD"), cancellable = true)
    //#endif
    private void hammer$ping(GuiGraphicsExtractor graphics, int width, int x, int y, PlayerInfo info, CallbackInfo ci) {
        if (info != null && FabricPlatform.tabPing(graphics, width, x, y, info.getLatency())) ci.cancel();
    }
}
