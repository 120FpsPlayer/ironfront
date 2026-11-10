package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.Options;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.fabric.FabricPlatform;

/** options.txt always gets the player's own brightness – never the fullbright value (newer versions refuse to save it). */
@Mixin(Options.class)
public abstract class OptionsMixin {
    @Inject(method = "save", at = @At("HEAD"))
    private void hammer$beforeSave(CallbackInfo ci) {
        FabricPlatform.beforeOptionsSave((Options) (Object) this);
    }

    @Inject(method = "save", at = @At("RETURN"))
    private void hammer$afterSave(CallbackInfo ci) {
        FabricPlatform.afterOptionsSave((Options) (Object) this);
    }
}
