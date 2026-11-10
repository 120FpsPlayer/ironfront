package pl.hammershop.client.module;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Stacks the HUD modules that the player has not placed by hand, per anchor, so they never overlap. */
public final class HudLayout {
    private static final float MARGIN = 2f;
    private static final float GAP = 2f;

    private HudLayout() {
    }

    /**
     * @param topRightOffset space to leave at the top right (the game's own effect icons live there)
     * @param editor         in the editor even hidden modules keep their slot, so the layout does not jump
     */
    public static void arrange(List<HudModule> modules, float sw, float sh, float topRightOffset, boolean editor) {
        for (HudModule.Anchor anchor : HudModule.Anchor.values()) {
            List<HudModule> stack = new ArrayList<>();
            for (HudModule m : modules) if (m.anchor == anchor && m.enabled() && !m.placed() && (m.w > 0 || editor)) stack.add(m);
            stack.sort(Comparator.comparingInt(m -> m.order));
            float cursor = switch (anchor) {
                case TOP_LEFT, TOP_CENTER -> MARGIN;
                case TOP_RIGHT -> MARGIN + topRightOffset;
                case MIDDLE -> sh / 2f + 16f;
                case BOTTOM_CENTER -> sh - 70f;
                default -> sh - MARGIN;
            };
            for (HudModule m : stack) {
                float w = m.scaledW();
                float h = m.scaledH();
                boolean down = anchor == HudModule.Anchor.TOP_LEFT || anchor == HudModule.Anchor.TOP_RIGHT || anchor == HudModule.Anchor.TOP_CENTER || anchor == HudModule.Anchor.MIDDLE;
                m.autoX = switch (anchor) {
                    case TOP_LEFT, BOTTOM_LEFT -> MARGIN;
                    case TOP_RIGHT, BOTTOM_RIGHT -> sw - w - MARGIN;
                    default -> (sw - w) / 2f;
                };
                if (down) {
                    m.autoY = cursor;
                    cursor += h + GAP;
                } else {
                    m.autoY = cursor - h;
                    cursor -= h + GAP;
                }
                m.autoX = Math.max(0, Math.min(sw - w, m.autoX));
                m.autoY = Math.max(0, Math.min(sh - h, m.autoY));
            }
        }
    }
}
