package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.OptionInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Sets an option past its normal limits (fullbright = brightness far above 100%). */
@Mixin(OptionInstance.class)
public interface OptionAccessor {
    @Accessor("value")
    void setHammerValue(Object value);
}
