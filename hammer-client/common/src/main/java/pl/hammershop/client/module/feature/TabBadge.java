package pl.hammershop.client.module.feature;

import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;

/**
 * The player list (Tab) shows who plays on Hammer Client: the H of the logo in front of their name, H+ for players
 * with Hammer+. Others see yours the same way – unless you switch that off.
 */
public final class TabBadge extends Module {
    private final Setting.Bool announce = bool("announce", true);
    private final Setting.Bool own = bool("own_badge", true);

    public TabBadge() {
        super("tabbadge", "badge", Category.VISUAL, true);
    }

    /** Tell the shop's server that this account is playing on Hammer Client, so others see the badge. */
    public boolean announce() {
        return announce.on();
    }

    /** Show the badge in front of your own name too. */
    public boolean own() {
        return own.on();
    }
}
