package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.hammershop.client.Hammer;

/** Notes every hit of the player (combo counter, reach display). */
@Mixin(MultiPlayerGameMode.class)
public abstract class GameModeMixin {
    @Inject(method = "attack", at = @At("HEAD"))
    private void hammer$attack(Player player, Entity target, CallbackInfo ci) {
        if (player == null || target == null) return;
        Hammer.attacked(Math.sqrt(target.getBoundingBox().distanceToSqr(player.getEyePosition())));
    }
}
