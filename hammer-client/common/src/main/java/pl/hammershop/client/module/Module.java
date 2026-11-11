package pl.hammershop.client.module;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.core.Config;
import pl.hammershop.client.core.Lang;

import java.util.ArrayList;
import java.util.List;

/** A switchable feature in the module panel, with its options. */
public abstract class Module {
    public enum Category {
        HUD("hud", "hud"),
        GAMEPLAY("gameplay", "gamepad"),
        VISUAL("visual", "palette");

        public final String id;
        public final String icon;

        Category(String id, String icon) {
            this.id = id;
            this.icon = icon;
        }

        public String label() {
            return Lang.t("category." + id);
        }
    }

    public final String id;
    public final String icon;
    public final Category category;
    private final boolean defaultOn;
    public final List<Setting<?>> settings = new ArrayList<>();

    protected Module(String id, String icon, Category category, boolean defaultOn) {
        this.id = id;
        this.icon = icon;
        this.category = category;
        this.defaultOn = defaultOn;
    }

    public String name() {
        return Lang.t("module." + id);
    }

    public String description() {
        return Lang.t("module." + id + ".desc");
    }

    /** Extra line under the description (e.g. "check the server rules"); null = none. */
    public String note() {
        return Lang.has("module." + id + ".note") ? Lang.t("module." + id + ".note") : null;
    }

    public Config.ModuleData data() {
        return Hammer.config().module(id);
    }

    public boolean enabled() {
        Boolean e = data().enabled;
        return e != null ? e : defaultOn;
    }

    public void setEnabled(boolean on) {
        if (on == enabled()) return;
        data().enabled = on;
        Hammer.config().markDirty();
        if (on) onEnable();
        else onDisable();
    }

    public void toggle() {
        setEnabled(!enabled());
    }

    /** Called when switched on (also once at start if enabled) / off (also when the profile changes). */
    public void onEnable() {
    }

    public void onDisable() {
    }

    /** 20 times per second while enabled. */
    public void tick() {
    }

    public void resetSettings() {
        for (Setting<?> s : settings) s.reset();
    }

    /** Marks an option as Hammer+ only. */
    protected <S extends Setting<?>> S plus(S setting) {
        setting.premium = true;
        return setting;
    }

    protected Setting.Bool bool(String id, boolean def) {
        Setting.Bool s = new Setting.Bool(this, id, def);
        settings.add(s);
        return s;
    }

    protected Setting.Slider slider(String id, float def, float min, float max, float step, String suffix) {
        Setting.Slider s = new Setting.Slider(this, id, def, min, max, step, suffix);
        settings.add(s);
        return s;
    }

    protected Setting.Choice choice(String id, int def, String... options) {
        Setting.Choice s = new Setting.Choice(this, id, def, options);
        settings.add(s);
        return s;
    }

    protected Setting.Color color(String id, int def, boolean chroma) {
        Setting.Color s = new Setting.Color(this, id, def, chroma);
        settings.add(s);
        return s;
    }
}
