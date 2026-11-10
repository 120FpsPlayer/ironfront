package pl.hammershop.client.fabric.mixin;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.fabric.FabricPlatform;
//#if MC >= 1.21.9
import net.minecraft.client.input.MouseButtonInfo;
//#endif

/** While zooming, the mouse wheel changes the zoom instead of the hotbar slot; clicks on our pause-menu buttons. */
@Mixin(MouseHandler.class)
public abstract class MouseMixin {
    @Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
    private void hammer$scroll(long window, double scrollX, double scrollY, CallbackInfo ci) {
        if (Hammer.platform() != null && Hammer.platform().inGameFocus() && Hammer.zoomScroll(scrollY)) ci.cancel();
    }

    //#if MC >= 1.21.9
    @Inject(method = "onButton", at = @At("HEAD"), cancellable = true)
    private void hammer$button(long window, MouseButtonInfo info, int action, CallbackInfo ci) {
        if (action == InputConstants.PRESS && info.button() == InputConstants.MOUSE_BUTTON_LEFT && FabricPlatform.pauseClick()) ci.cancel();
    }
    //#else
    @Inject(method = "onPress", at = @At("HEAD"), cancellable = true)
    private void hammer$button(long window, int button, int action, int mods, CallbackInfo ci) {
        if (action == InputConstants.PRESS && button == InputConstants.MOUSE_BUTTON_LEFT && FabricPlatform.pauseClick()) ci.cancel();
    }
    //#endif
}
