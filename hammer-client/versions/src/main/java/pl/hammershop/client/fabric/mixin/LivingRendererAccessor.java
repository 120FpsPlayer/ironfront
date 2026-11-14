package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

/** LivingEntityRenderer.addLayer is protected – the cosmetics layer is added to the player renderer through this. */
@Mixin(LivingEntityRenderer.class)
public interface LivingRendererAccessor {
    @Invoker("addLayer")
    boolean hammer$addLayer(RenderLayer<?, ?> layer);
}
