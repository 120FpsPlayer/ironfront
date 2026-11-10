package pl.hammershop.client.fabric;

import net.fabricmc.api.ClientModInitializer;

/** Fabric entry point. The game is still starting here, so only the key bindings are registered; the rest waits. */
public final class HammerClientMod implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        FabricPlatform.registerKeys();
    }
}
