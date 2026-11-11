package pl.hammershop.client.fabric.mixin;

import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Constant;
import org.spongepowered.asm.mixin.injection.ModifyConstant;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.fabric.FabricPlatform;

/** Chat: the time in front of every new message, and room for far more than the last 100 messages. */
@Mixin(ChatComponent.class)
public abstract class ChatMixin {
    //#if MC >= 26.1
    @ModifyVariable(method = "addMessage", at = @At("HEAD"), argsOnly = true)
    //#else
    @ModifyVariable(method = "addMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/GuiMessageTag;)V", at = @At("HEAD"), argsOnly = true)
    //#endif
    private Component hammer$time(Component message) {
        return FabricPlatform.chat(message);
    }

    @ModifyConstant(method = {"addMessageToDisplayQueue", "addMessageToQueue", "addRecentChat"}, constant = @Constant(intValue = 100))
    private int hammer$history(int limit) {
        return Hammer.chatHistory(limit);
    }
}
