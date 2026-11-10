package pl.hammershop.client.module.hud;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.core.Fmt;
import pl.hammershop.client.core.Lang;
import pl.hammershop.client.module.HudCanvas;
import pl.hammershop.client.module.HudModule;
import pl.hammershop.client.module.Setting;
import pl.hammershop.client.ui.Draw;

/** Who you are aiming at: name, health bar and distance. Stays for a moment after you look away. */
public final class TargetHud extends HudModule {
    private final Setting.Bool distance = bool("distance", true);
    private final Setting.Bool onlyPlayers = bool("only_players", false);
    private final Setting.Bool background = bool("background", true);
    private final Setting.Color backgroundColor = color("background_color", 0x90000000, false);

    private Game.Target last;
    private long seen;
    private float shown = 1f; // health share the bar is animating towards

    public TargetHud() {
        super("target", "target", false, Anchor.TOP_CENTER);
        order = 5;
    }

    @Override
    protected void draw(HudCanvas c) {
        Game.Target t = c.game.target();
        if (t != null && onlyPlayers.on() && !t.player()) t = null;
        long now = System.currentTimeMillis();
        if (t != null) {
            if (last == null || !last.name().equals(t.name())) shown = share(t);
            last = t;
            seen = now;
        } else if (c.editor) {
            last = new Game.Target(Lang.t("hud.sample_target"), 14f, 20f, 2.8, true);
            seen = now;
        } else if (last == null || now - seen > 1500) {
            last = null;
            return;
        }
        t = last;
        float fade = c.editor ? 1f : Math.min(1f, Math.max(0f, 1f - (now - seen - 1000) / 500f));
        float share = share(t);
        shown += (share - shown) * 0.2f;
        String hp = Fmt.num(Math.max(0f, t.health()), 1) + " / " + Fmt.num(t.maxHealth(), 0);
        String dist = distance.on() ? Fmt.num((float) t.distance(), 1) + " m" : "";
        float w = Math.max(96, Math.max(c.textWidth(t.name()) + (dist.isEmpty() ? 0 : c.textWidth(dist) + 10), c.textWidth(hp)) + 12);
        float h = 31;
        if (background.on()) c.plate(w, h, Draw.alpha(backgroundColor.get(), ((backgroundColor.get() >>> 24) / 255f) * fade));
        c.text(t.name(), 6, 4, Draw.alpha(0xFFFFFFFF, fade), true);
        if (!dist.isEmpty()) c.text(dist, w - 6 - c.textWidth(dist), 4, Draw.alpha(0xFFFFC27E, fade), true);
        // health bar: green → yellow → red
        float barW = w - 12;
        int color = share > 0.5f ? Draw.mix(0xFFFFD43B, 0xFF51CF66, (share - 0.5f) * 2f) : Draw.mix(0xFFFF6B6B, 0xFFFFD43B, share * 2f);
        c.d.rrect(6, 15, barW, 4, 2, Draw.alpha(0xFF000000, 0.55f * fade));
        if (shown > share + 0.005f) c.d.rrect(6, 15, Math.max(4, barW * Math.min(1f, shown)), 4, 2, Draw.alpha(0xFFFFFFFF, 0.55f * fade));
        if (share > 0) c.d.rrect(6, 15, Math.max(4, barW * share), 4, 2, Draw.alpha(color, fade));
        c.text(hp, 6, 21, Draw.alpha(color, fade), true);
        c.size(w, h);
    }

    private static float share(Game.Target t) {
        return t.maxHealth() <= 0 ? 0f : Math.max(0f, Math.min(1f, t.health() / t.maxHealth()));
    }
}
