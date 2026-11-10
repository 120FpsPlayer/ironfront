package pl.hammershop.client.fabric;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.screens.ModMenuScreen;
import pl.hammershop.client.ui.Input;
import pl.hammershop.client.ui.UiScreen;
//#if MC >= 1.21.9
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
//#endif

/** A game screen that shows one of our {@link UiScreen}s and passes the input on. */
public final class BridgeScreen extends Screen {
    public final UiScreen ui;
    private boolean opened;
    private boolean menuKeyArmed;
    private boolean menuKeyWasDown = true;

    public BridgeScreen(UiScreen ui) {
        super(Component.literal("Hammer Client"));
        this.ui = ui;
    }

    @Override
    protected void init() {
        if (!opened) {
            opened = true;
            ui.opened();
        }
    }

    @Override
    public void removed() {
        ui.closed();
    }

    @Override
    public boolean isPauseScreen() {
        return ui.pausesGame();
    }

    @Override
    public boolean shouldCloseOnEsc() {
        return false; // Esc goes through Hammer.escape (popups close first)
    }

    @Override
    public void onClose() {
        Hammer.back(ui);
    }

    // ───────────── drawing ─────────────

    private void draw(GuiGraphicsExtractor g) {
        // The panel key closes the panel again. Polled, because key events of a held key repeat.
        boolean down = FabricPlatform.rawKeyDown("menu");
        if (!down) menuKeyArmed = true;
        else if (menuKeyArmed && !menuKeyWasDown && ui instanceof ModMenuScreen && !ui.state.typing()) {
            Hammer.back(ui);
            return;
        }
        menuKeyWasDown = down;
        FabricPlatform.drawScreen(g, ui);
    }

    private void background(GuiGraphicsExtractor g, float partialTick) {
        if (Minecraft.getInstance().level == null || !ui.blursWorld()) return;
        //#if MC >= 26.1
        extractBlurredBackground(g);
        //#elif MC >= 1.21.6
        renderBlurredBackground(g);
        //#elif MC >= 1.21.2
        renderBlurredBackground();
        //#else
        renderBlurredBackground(partialTick);
        //#endif
    }

    //#if MC >= 26.1
    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        draw(g);
    }

    @Override
    public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        background(g, partialTick);
    }
    //#else
    @Override
    public void render(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        //#if MC < 1.21.6
        background(g, partialTick); // newer versions call renderBackground themselves
        //#endif
        draw(g);
    }

    @Override
    public void renderBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        //#if MC >= 1.21.6
        background(g, partialTick);
        //#endif
    }
    //#endif

    // ───────────── input ─────────────

    // Key and button numbers differ between game versions (26.3 uses SDL numbering), so they are translated to
    // the fixed codes of our UI through the game's own constants.
    private static int neutralKey(int key) {
        if (key == InputConstants.KEY_ESCAPE) return Input.KEY_ESCAPE;
        if (key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER) return Input.KEY_ENTER;
        if (key == InputConstants.KEY_BACKSPACE) return Input.KEY_BACKSPACE;
        if (key == InputConstants.KEY_DELETE) return Input.KEY_DELETE;
        if (key == InputConstants.KEY_A) return Input.KEY_A;
        if (key == InputConstants.KEY_V) return Input.KEY_V;
        return -1;
    }

    private static int neutralButton(int button) {
        if (button == InputConstants.MOUSE_BUTTON_LEFT) return 0;
        if (button == InputConstants.MOUSE_BUTTON_RIGHT) return 1;
        if (button == InputConstants.MOUSE_BUTTON_MIDDLE) return 2;
        return -1;
    }

    private boolean key(int gameKey, int gameMods) {
        int key = neutralKey(gameKey);
        if (key == Input.KEY_ESCAPE) Hammer.escape(ui);
        else if (key >= 0) Hammer.input().key(key, (gameMods & InputConstants.MOD_CONTROL) != 0 ? Input.MOD_CTRL : 0);
        return true;
    }

    //#if MC >= 1.21.9
    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        Hammer.input().mouseDown(neutralButton(event.button()));
        return true;
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent event) {
        Hammer.input().mouseUp(neutralButton(event.button()));
        return true;
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        return key(event.key(), event.modifiers());
    }

    @Override
    public boolean charTyped(CharacterEvent event) {
        Hammer.input().typed(event.codepoint());
        return true;
    }
    //#else
    @Override
    public boolean mouseClicked(double x, double y, int button) {
        Hammer.input().mouseDown(neutralButton(button));
        return true;
    }

    @Override
    public boolean mouseReleased(double x, double y, int button) {
        Hammer.input().mouseUp(neutralButton(button));
        return true;
    }

    @Override
    public boolean keyPressed(int key, int scanCode, int mods) {
        return key(key, mods);
    }

    @Override
    public boolean charTyped(char c, int mods) {
        Hammer.input().typed(c);
        return true;
    }
    //#endif

    @Override
    public boolean mouseScrolled(double x, double y, double scrollX, double scrollY) {
        Hammer.input().scroll(scrollY);
        return true;
    }
}
