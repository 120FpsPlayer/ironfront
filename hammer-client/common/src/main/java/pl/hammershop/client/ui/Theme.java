package pl.hammershop.client.ui;

import pl.hammershop.client.Hammer;

/** Colours of the Hammer UI: warm dark panels and an accent the player can change. */
public final class Theme {
    public static final int TEXT = 0xFFF7EFE7;
    public static final int MUTED = 0xFFB9A797;
    public static final int DIM = 0xFF85725F;
    public static final int INK = 0xFF2A1405;
    public static final int BG = 0xFF0E0B09;
    public static final int PANEL = 0xF5161009;
    public static final int PANEL_SOLID = 0xFF17110B;
    public static final int CARD = 0xFF1F1811;
    public static final int CARD_HOVER = 0xFF2A2017;
    public static final int FIELD = 0xFF120D08;
    public static final int LINE = 0x26FFC48C;
    public static final int LINE_STRONG = 0x4DFFC48C;
    public static final int OK = 0xFF5EE08D;
    public static final int WARN = 0xFFFFC857;
    public static final int ERR = 0xFFFF7A7A;
    public static final int DISCORD = 0xFF5865F2;
    public static final int DISCORD_LIGHT = 0xFF7983F5;

    /** id, main, light, dark */
    public static final String[] ACCENT_IDS = {"orange", "gold", "red", "pink", "purple", "blue", "cyan", "green"};
    private static final int[][] ACCENTS = {
            {0xFFFF9F43, 0xFFFFC27E, 0xFFF07A1C},
            {0xFFFFC83D, 0xFFFFE08A, 0xFFE0A106},
            {0xFFFF6B6B, 0xFFFFA3A3, 0xFFD83A3A},
            {0xFFFF7EB6, 0xFFFFB3D4, 0xFFE0468C},
            {0xFFB18CFF, 0xFFD3BFFF, 0xFF7C4DFF},
            {0xFF5CA8FF, 0xFFA3CEFF, 0xFF2979E0},
            {0xFF4DD9E6, 0xFF9CECF3, 0xFF14A8B8},
            {0xFF5EE08D, 0xFFA5F0BF, 0xFF2BB35F},
    };

    private Theme() {
    }

    private static int[] accentSet() {
        String id = Hammer.config() != null ? Hammer.config().accent : "orange";
        for (int i = 0; i < ACCENT_IDS.length; i++) if (ACCENT_IDS[i].equals(id)) return ACCENTS[i];
        return ACCENTS[0];
    }

    public static int accent() {
        return accentSet()[0];
    }

    public static int accentLight() {
        return accentSet()[1];
    }

    public static int accentDark() {
        return accentSet()[2];
    }

    public static int accentOf(String id) {
        for (int i = 0; i < ACCENT_IDS.length; i++) if (ACCENT_IDS[i].equals(id)) return ACCENTS[i][0];
        return ACCENTS[0][0];
    }
}
