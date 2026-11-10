package pl.hammershop.client.ui;

import java.util.ArrayList;
import java.util.List;

/** Input events collected between frames (the game's screen forwards them) and handed to the next frame. */
public final class Input {
    public static final int KEY_ESCAPE = 256;
    public static final int KEY_ENTER = 257;
    public static final int KEY_BACKSPACE = 259;
    public static final int KEY_DELETE = 261;
    public static final int KEY_A = 65;
    public static final int KEY_V = 86;
    public static final int MOD_CTRL = 2;

    private final boolean[] down = new boolean[3];
    private final boolean[] pressed = new boolean[3];
    private final boolean[] released = new boolean[3];
    private float scroll;
    private final StringBuilder typed = new StringBuilder();
    private final List<int[]> keys = new ArrayList<>();

    public synchronized void mouseDown(int button) {
        if (button < 0 || button > 2) return;
        down[button] = true;
        pressed[button] = true;
    }

    public synchronized void mouseUp(int button) {
        if (button < 0 || button > 2) return;
        down[button] = false;
        released[button] = true;
    }

    public synchronized void scroll(double amount) {
        scroll += (float) amount;
    }

    public synchronized void key(int key, int mods) {
        keys.add(new int[] {key, mods});
    }

    public synchronized void typed(int codePoint) {
        if (codePoint >= 32 && codePoint != 127) typed.appendCodePoint(codePoint);
    }

    /** Forget everything (when a screen opens or closes). */
    public synchronized void reset() {
        for (int i = 0; i < 3; i++) down[i] = pressed[i] = released[i] = false;
        scroll = 0;
        typed.setLength(0);
        keys.clear();
    }

    synchronized Frame take() {
        Frame f = new Frame(down.clone(), pressed.clone(), released.clone(), scroll, typed.toString(), new ArrayList<>(keys));
        for (int i = 0; i < 3; i++) pressed[i] = released[i] = false;
        scroll = 0;
        typed.setLength(0);
        keys.clear();
        return f;
    }

    record Frame(boolean[] down, boolean[] pressed, boolean[] released, float scroll, String typed, List<int[]> keys) {
    }
}
