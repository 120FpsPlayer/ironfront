package pl.hammershop.client.core;

import java.util.Locale;

/** Number and time formatting (decimal comma for Polish). */
public final class Fmt {
    public static boolean comma = true;

    private Fmt() {
    }

    public static String num(double v, int decimals) {
        String s = String.format(Locale.ROOT, "%." + decimals + "f", v);
        return comma ? s.replace('.', ',') : s;
    }

    /** 3725 s → "1:02:05", 125 s → "2:05". */
    public static String clock(long seconds) {
        long h = seconds / 3600;
        long m = (seconds % 3600) / 60;
        long s = seconds % 60;
        return h > 0 ? String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) : String.format(Locale.ROOT, "%d:%02d", m, s);
    }

    public static String roman(int n) {
        String[] r = {"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"};
        return n >= 0 && n < r.length ? r[n] : String.valueOf(n);
    }
}
