package pl.hammershop.client.ui;

/**
 * One of our screens. It is drawn in immediate mode: {@link #render} is called every frame with the input of that
 * frame and draws and handles everything in one pass. Per-screen state (animations, focus, scrolling) lives in
 * {@link #state}.
 */
public abstract class UiScreen {
    public final UiState state = new UiState();
    /** Where Esc goes back to (null = close and return to the game / main menu). */
    public UiScreen parent;

    public abstract void render(Ui ui);

    /** Called when the screen is opened / closed by the game. */
    public void opened() {
    }

    public void closed() {
    }

    /** Whether the game world (singleplayer) pauses while this screen is open. */
    public boolean pausesGame() {
        return false;
    }

    /** Whether the world behind the screen is blurred (the HUD editor needs it sharp). */
    public boolean blursWorld() {
        return true;
    }

    /** Esc pressed: return false to keep the screen open. */
    public boolean escape() {
        return true;
    }
}
