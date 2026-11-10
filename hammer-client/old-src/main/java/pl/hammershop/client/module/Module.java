package pl.hammershop.client.module;

import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import pl.hammershop.client.HammerClient;
import pl.hammershop.client.config.HammerConfig;

/** A switchable feature in the module panel. */
public abstract class Module {
    public enum Category {
        HUD("hud"),
        GAMEPLAY("gameplay");

        public final String key;

        Category(String key) {
            this.key = key;
        }

        public Component label() {
            return Component.translatable("hammerclient.category." + key);
        }
    }

    public final String id;
    public final Category category;
    private final boolean defaultOn;

    protected Module(String id, Category category, boolean defaultOn) {
        this.id = id;
        this.category = category;
        this.defaultOn = defaultOn;
    }

    public Component name() {
        return Component.translatable("hammerclient.module." + id);
    }

    public Component description() {
        return Component.translatable("hammerclient.module." + id + ".desc");
    }

    public HammerConfig.ModuleState state() {
        return HammerClient.config().module(id, defaultOn);
    }

    public boolean enabled() {
        return state().enabled;
    }

    public void toggle() {
        HammerConfig.ModuleState s = state();
        s.enabled = !s.enabled;
        onToggle(Minecraft.getInstance(), s.enabled);
        HammerClient.config().save();
    }

    protected void onToggle(Minecraft mc, boolean on) {
    }

    public void tick(Minecraft mc) {
    }
}
