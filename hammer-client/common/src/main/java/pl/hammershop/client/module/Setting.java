package pl.hammershop.client.module;

import pl.hammershop.client.Hammer;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.ui.Draw;

import java.util.Map;

/** One option of a module, stored in the active profile. */
public abstract class Setting<T> {
    public final Module module;
    public final String id;
    protected final T def;

    protected Setting(Module module, String id, T def) {
        this.module = module;
        this.id = id;
        this.def = def;
    }

    /** "setting.&lt;module&gt;.&lt;id&gt;" if it exists, else the shared "setting.&lt;id&gt;". */
    public String label() {
        String own = "setting." + module.id + "." + id;
        return Lang.has(own) ? Lang.t(own) : Lang.t("setting." + id);
    }

    protected Map<String, Object> values() {
        return module.data().values;
    }

    protected void store(Object value) {
        values().put(id, value);
        Hammer.config().markDirty();
    }

    public abstract T get();

    public abstract void set(T value);

    public void reset() {
        values().remove(id);
        values().remove(id + ".chroma");
        Hammer.config().markDirty();
    }

    public static final class Bool extends Setting<Boolean> {
        public Bool(Module m, String id, boolean def) {
            super(m, id, def);
        }

        public Boolean get() {
            return values().get(id) instanceof Boolean b ? b : def;
        }

        public void set(Boolean value) {
            store(value);
        }

        public boolean on() {
            return get();
        }
    }

    public static final class Slider extends Setting<Float> {
        public final float min;
        public final float max;
        public final float step;
        /** "%", "x", "" … shown after the number; values with step ≥ 1 are shown as whole numbers. */
        public final String suffix;

        public Slider(Module m, String id, float def, float min, float max, float step, String suffix) {
            super(m, id, def);
            this.min = min;
            this.max = max;
            this.step = step;
            this.suffix = suffix;
        }

        public Float get() {
            return values().get(id) instanceof Number n ? Math.max(min, Math.min(max, n.floatValue())) : def;
        }

        public void set(Float value) {
            store((double) Math.round(value * 1000f) / 1000.0);
        }

        public float value() {
            return get();
        }

        public String text() {
            float v = get();
            String num = step >= 1 ? String.valueOf(Math.round(v)) : suffix.equals("%") ? String.valueOf(Math.round(v * 100)) : String.format(java.util.Locale.ROOT, "%.2f", v).replaceAll("0$", "");
            return num + suffix;
        }
    }

    public static final class Choice extends Setting<Integer> {
        /** Option ids; their labels are "option.&lt;id&gt;". */
        public final String[] options;

        public Choice(Module m, String id, int def, String... options) {
            super(m, id, def);
            this.options = options;
        }

        public Integer get() {
            Object v = values().get(id);
            if (v instanceof String s) for (int i = 0; i < options.length; i++) if (options[i].equals(s)) return i;
            return def;
        }

        public void set(Integer value) {
            store(options[Math.max(0, Math.min(options.length - 1, value))]);
        }

        public String option() {
            return options[get()];
        }

        public boolean is(String option) {
            return option().equals(option);
        }

        public String[] labels() {
            String[] l = new String[options.length];
            for (int i = 0; i < options.length; i++) l[i] = Lang.t("option." + options[i]);
            return l;
        }
    }

    public static final class Color extends Setting<Integer> {
        public final boolean allowChroma;

        public Color(Module m, String id, int def, boolean allowChroma) {
            super(m, id, def);
            this.allowChroma = allowChroma;
        }

        public Integer get() {
            return values().get(id) instanceof Number n ? (int) n.longValue() : def;
        }

        public void set(Integer value) {
            store((long) value & 0xFFFFFFFFL);
        }

        public boolean chroma() {
            return allowChroma && values().get(id + ".chroma") instanceof Boolean b && b;
        }

        public void setChroma(boolean on) {
            values().put(id + ".chroma", on);
            Hammer.config().markDirty();
        }

        /** The colour to draw with right now (animated when rainbow is on); `offset` shifts the rainbow. */
        public int argb(float offset) {
            int c = get();
            if (!chroma()) return c;
            float hue = (System.currentTimeMillis() % 4000L) / 4000f + offset;
            return (c & 0xFF000000) | (Draw.hsv(hue, 0.7f, 1f) & 0xFFFFFF);
        }

        public int argb() {
            return argb(0);
        }
    }
}
