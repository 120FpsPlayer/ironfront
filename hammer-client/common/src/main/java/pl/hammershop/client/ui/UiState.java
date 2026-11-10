package pl.hammershop.client.ui;

import java.util.HashMap;
import java.util.Map;

/** What a screen remembers between frames. */
public final class UiState {
    final Map<String, Float> anims = new HashMap<>();
    final Map<String, Float> scroll = new HashMap<>();
    final Map<String, Float> scrollTarget = new HashMap<>();
    final Map<String, Object> results = new HashMap<>();
    String active;      // widget being dragged
    String focus;       // text field with the keyboard
    Popup popup;        // open dropdown / colour picker
    float[] popupRect;  // where it was drawn last frame (blocks the widgets below)
    public long opened = System.nanoTime();
    long lastFrame;

    /** Seconds since the screen was created. */
    public float age() {
        return (System.nanoTime() - opened) / 1e9f;
    }

    /** A text field has the keyboard. */
    public boolean typing() {
        return focus != null;
    }

    /** Esc: closes an open popup or leaves a text field; true if there was one. */
    public boolean focusOrPopupClosed() {
        if (popup != null) {
            closePopup();
            return true;
        }
        if (focus != null) {
            focus = null;
            return true;
        }
        return false;
    }

    public void closePopup() {
        popup = null;
        popupRect = null;
    }

    interface Popup {
        String id();

        /** Draws the popup, returns its rectangle {x, y, w, h}. */
        float[] draw(Ui ui);
    }
}
