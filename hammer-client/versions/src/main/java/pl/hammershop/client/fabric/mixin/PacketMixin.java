package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundSetTimePacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.Hammer;

/** The server sends the time once per second of its own clock – that is how the TPS display measures lag. */
@Mixin(ClientPacketListener.class)
public abstract class PacketMixin {
    @Inject(method = "handleSetTime", at = @At("TAIL"))
    private void hammer$time(ClientboundSetTimePacket packet, CallbackInfo ci) {
        Hammer.timePacket();
    }
}
