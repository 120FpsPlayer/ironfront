package pl.hammershop.client.fabric;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.Window;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.CameraType;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.options.controls.KeyBindsScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.sounds.SoundEvents;
//#if MC < 26.3
import net.minecraft.util.Util;
//#endif
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import pl.hammershop.client.Hammer;
import pl.hammershop.client.api.Game;
import pl.hammershop.client.api.Keys;
import pl.hammershop.client.api.Platform;
import pl.hammershop.client.core.Log;
import pl.hammershop.client.fabric.mixin.OptionAccessor;
import pl.hammershop.client.screens.HudEditorScreen;
import pl.hammershop.client.ui.UiScreen;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
//#if MC >= 26.1
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
//#else
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
//#endif

/** Hammer Client's link to the game: the {@link Platform} and {@link Game} of this Minecraft version, and the hooks the mixins call. */
public final class FabricPlatform implements Platform, Game {
    public static final FabricPlatform INSTANCE = new FabricPlatform();
    static final Map<String, KeyMapping> KEYS = new LinkedHashMap<>();
    private static final GfxImpl GFX = new GfxImpl();
    private static boolean readingRealTime;
    private static boolean ready;
    private static boolean failed;
    private static long pauseDrawn;
    private static int ticks;

    private FabricPlatform() {
    }

    private static Minecraft mc() {
        return Minecraft.getInstance();
    }

    // ───────────── start ─────────────

    /** Called while the game starts (before its options are read), so the keys show up in Controls. */
    static void registerKeys() {
        //#if MC >= 1.21.9
        KeyMapping.Category category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("hammerclient", "main"));
        //#else
        String category = "category.hammerclient";
        //#endif
        for (Keys k : Keys.values()) {
            KeyMapping mapping = new KeyMapping("key.hammerclient." + k.id, InputConstants.Type.KEYSYM, defaultKey(k), category);
            //#if MC >= 26.1
            KeyMappingHelper.registerKeyMapping(mapping);
            //#else
            KeyBindingHelper.registerKeyBinding(mapping);
            //#endif
            KEYS.put(k.id, mapping);
        }
    }

    /** Key codes differ between game versions (26.3 moved from GLFW to SDL numbering), so the game's own constants are used. */
    private static int defaultKey(Keys k) {
        return switch (k) {
            case MENU -> InputConstants.KEY_RSHIFT;
            case ZOOM -> InputConstants.KEY_C;
            case FREELOOK -> InputConstants.KEY_LALT;
            default -> InputConstants.UNKNOWN.getValue();
        };
    }

    /** Hammer Client starts on first use, once the game has its options. If that fails the game simply runs without it. */
    static boolean ok() {
        if (ready) return true;
        if (failed) return false;
        Minecraft mc = mc();
        if (mc == null || mc.options == null) return false;
        loadHookedClasses();
        try {
            Hammer.init(INSTANCE);
            Runtime.getRuntime().addShutdownHook(new Thread(Hammer::shutdown, "Hammer Client"));
            ready = true;
        } catch (Throwable t) {
            failed = true;
            Log.warn("Nie udało się uruchomić Hammer Client – gra działa dalej bez niego", t);
        }
        return ready;
    }

    /**
     * Some of our hooks sit in classes the game only loads when you join a world. Touching those classes at start
     * makes a hook that does not fit this game version fail right away – where the automatic tests of every
     * supported version see it – instead of in the middle of joining a server.
     */
    private static void loadHookedClasses() {
        Class<?>[] hooked = {
            PauseScreen.class, net.minecraft.client.multiplayer.MultiPlayerGameMode.class, net.minecraft.client.multiplayer.ClientPacketListener.class,
            ClientLevel.class, net.minecraft.world.level.Level.class, LocalPlayer.class, net.minecraft.client.Camera.class,
            //#if MC >= 26.3
            net.minecraft.client.ClientClockManager.ClientClockInstance.class,
            //#elif MC >= 26.1
            net.minecraft.client.ClientClockManager.class,
            //#else
            ClientLevel.ClientLevelData.class,
            //#endif
        };
        if (hooked.length == 0) throw new IllegalStateException();
    }

    // ───────────── hooks (called by the mixins) ─────────────

    public static void tick() {
        if (!ok()) return;
        ticks++;
        pollKeys();
        Hammer.tick();
    }

    // Our keys are read from the keyboard itself. The game hands a key press to only one binding, so a key that is
    // also bound to something else (C is "save hotbar" in creative mode) might never reach ours otherwise.
    private static final Map<String, boolean[]> KEY_STATE = new HashMap<>(); // id → {down, pressed and not yet used}

    private static void pollKeys() {
        boolean free = screen() == null;
        for (String id : KEYS.keySet()) {
            boolean down = rawKeyDown(id);
            boolean[] state = KEY_STATE.computeIfAbsent(id, k -> new boolean[2]);
            if (down && !state[0] && free) state[1] = true;
            state[0] = down;
        }
    }

    private static boolean onKeyboard(KeyMapping mapping) {
        return !mapping.isUnbound() && InputConstants.getKey(mapping.saveString()).getType() == InputConstants.Type.KEYSYM;
    }

    /** The time the game should show: the time changer's pick, or the real one (always the real one for our own HUD). */
    public static long shownTime(long real) {
        return readingRealTime ? real : Hammer.dayTime(real);
    }

    /** The vanilla title screen becomes our main menu (unless the player turned that off). */
    public static Screen swap(Screen screen) {
        if (!(screen instanceof TitleScreen) && !(screen == null && mc().level == null)) return screen;
        if (!ok()) return screen;
        UiScreen menu = Hammer.mainMenu();
        return menu == null ? screen : new BridgeScreen(menu);
    }

    public static void hud(GuiGraphicsExtractor g) {
        if (!ok()) return;
        pollKeys();
        Minecraft mc = mc();
        //#if MC >= 26.2
        if (mc.gui.hud.isHidden()) return;
        //#else
        if (mc.options.hideGui) return;
        //#endif
        if (mc.getDebugOverlay().showDebugScreen()) return;
        if (screen() instanceof BridgeScreen b && b.ui instanceof HudEditorScreen) return; // the editor draws the HUD itself
        GFX.begin(g);
        try {
            Hammer.renderHud(GFX);
        } finally {
            GFX.end();
        }
    }

    static void drawScreen(GuiGraphicsExtractor g, UiScreen ui) {
        if (!ok()) return;
        Minecraft mc = mc();
        GFX.begin(g);
        try {
            Hammer.renderScreen(ui, GFX, mouseX(mc), mouseY(mc));
        } finally {
            GFX.end();
        }
    }

    /** Our buttons on the vanilla pause menu. */
    public static void pauseOverlay(GuiGraphicsExtractor g) {
        if (!ok()) return;
        Minecraft mc = mc();
        GFX.begin(g);
        try {
            Hammer.renderPauseOverlay(GFX, mouseX(mc), mouseY(mc));
        } finally {
            GFX.end();
        }
        pauseDrawn = System.nanoTime();
    }

    /** A left click while the pause menu (with our buttons) is showing; true = one of our buttons took it. */
    public static boolean pauseClick() {
        if (!ready || System.nanoTime() - pauseDrawn > 500_000_000L || !(screen() instanceof PauseScreen)) return false;
        Minecraft mc = mc();
        return Hammer.pauseClick(mouseX(mc), mouseY(mc));
    }

    private static float mouseX(Minecraft mc) {
        Window w = mc.getWindow();
        return (float) (mc.mouseHandler.xpos() * w.getGuiScaledWidth() / Math.max(1, w.getScreenWidth()));
    }

    private static float mouseY(Minecraft mc) {
        Window w = mc.getWindow();
        return (float) (mc.mouseHandler.ypos() * w.getGuiScaledHeight() / Math.max(1, w.getScreenHeight()));
    }

    static Screen screen() {
        //#if MC >= 26.2
        return mc().gui.screen();
        //#else
        return mc().screen;
        //#endif
    }

    static void setScreen(Screen screen) {
        //#if MC >= 26.2
        mc().gui.setScreen(screen);
        //#else
        mc().setScreen(screen);
        //#endif
    }

    /** Physical state of one of our keys – also while a screen is open (key bindings are released then). */
    static boolean rawKeyDown(String id) {
        KeyMapping mapping = KEYS.get(id);
        if (mapping == null || mapping.isUnbound()) return false;
        InputConstants.Key key = InputConstants.getKey(mapping.saveString());
        if (key.getType() != InputConstants.Type.KEYSYM || key.getValue() < 0) return false;
        //#if MC >= 26.3
        return InputConstants.isKeyDown(key.getValue());
        //#elif MC >= 1.21.9
        return InputConstants.isKeyDown(mc().getWindow(), key.getValue());
        //#else
        return InputConstants.isKeyDown(mc().getWindow().getWindow(), key.getValue());
        //#endif
    }

    // ───────────── Platform ─────────────

    @Override
    public String minecraftVersion() {
        return FabricLoader.getInstance().getModContainer("minecraft").map(m -> m.getMetadata().getVersion().getFriendlyString()).orElse("?");
    }

    @Override
    public Path configDir() {
        return FabricLoader.getInstance().getConfigDir();
    }

    @Override
    public String language() {
        Options o = mc().options;
        return o == null || o.languageCode == null ? "en_us" : o.languageCode;
    }

    @Override
    public Game game() {
        return this;
    }

    @Override
    public void show(UiScreen screen) {
        setScreen(screen == null ? null : new BridgeScreen(screen));
    }

    @Override
    public void showVanilla(Vanilla which, UiScreen back) {
        Minecraft mc = mc();
        Screen parent = back == null ? null : new BridgeScreen(back);
        switch (which) {
            case SINGLEPLAYER -> setScreen(new SelectWorldScreen(parent));
            case MULTIPLAYER -> setScreen(new JoinMultiplayerScreen(parent));
            case CONTROLS -> setScreen(new KeyBindsScreen(parent, mc.options));
            //#if MC >= 26.1 && MC < 26.3
            default -> setScreen(new OptionsScreen(parent, mc.options, mc.level != null));
            //#else
            default -> setScreen(new OptionsScreen(parent, mc.options));
            //#endif
        }
    }

    @Override
    public void quit() {
        mc().stop();
    }

    @Override
    public void openUrl(String url) {
        if (url == null || !url.startsWith("https://")) return;
        try {
            //#if MC >= 26.3
            com.mojang.blaze3d.Blaze3D.openUri(java.net.URI.create(url));
            //#else
            Util.getPlatform().openUri(url);
            //#endif
        } catch (RuntimeException e) {
            Log.warn("Nie udało się otworzyć " + url, e);
        }
    }

    @Override
    public void clickSound() {
        mc().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0F));
    }

    @Override
    public String clipboard() {
        String s = mc().keyboardHandler.getClipboard();
        return s == null ? "" : s;
    }

    @Override
    public void setClipboard(String text) {
        mc().keyboardHandler.setClipboard(text);
    }

    @Override
    public boolean keyHeld(String id) {
        KeyMapping m = KEYS.get(id);
        return m != null && (m.isDown() || (screen() == null && rawKeyDown(id)));
    }

    @Override
    public boolean keyPressed(String id) {
        KeyMapping m = KEYS.get(id);
        if (m == null) return false;
        boolean clicked = false;
        while (m.consumeClick()) clicked = true;
        boolean[] state = KEY_STATE.get(id);
        boolean typed = state != null && state[1];
        if (state != null) state[1] = false;
        return onKeyboard(m) ? typed : clicked; // a mouse button bound to it comes through the game's own clicks
    }

    @Override
    public String keyName(String id) {
        KeyMapping m = KEYS.get(id);
        return m == null ? "?" : m.getTranslatedKeyMessage().getString();
    }

    private static KeyMapping move(Move key) {
        Options o = mc().options;
        return switch (key) {
            case FORWARD -> o.keyUp;
            case BACK -> o.keyDown;
            case LEFT -> o.keyLeft;
            case RIGHT -> o.keyRight;
            case JUMP -> o.keyJump;
            case SNEAK -> o.keyShift;
            case SPRINT -> o.keySprint;
            case ATTACK -> o.keyAttack;
            case USE -> o.keyUse;
        };
    }

    @Override
    public boolean moveKey(Move key) {
        return move(key).isDown();
    }

    @Override
    public String moveKeyName(Move key) {
        return move(key).getTranslatedKeyMessage().getString();
    }

    @Override
    public boolean mouseHeld(int button) {
        return button == 0 ? mc().mouseHandler.isLeftPressed() : mc().mouseHandler.isRightPressed();
    }

    @Override
    public boolean toggleSprint() {
        return mc().options.toggleSprint().get();
    }

    @Override
    public void setToggleSprint(boolean on) {
        mc().options.toggleSprint().set(on);
    }

    @Override
    public boolean toggleSneak() {
        return mc().options.toggleCrouch().get();
    }

    @Override
    public void setToggleSneak(boolean on) {
        mc().options.toggleCrouch().set(on);
    }

    @Override
    public double damageTilt() {
        return mc().options.damageTiltStrength().get();
    }

    @Override
    public void setDamageTilt(double value) {
        mc().options.damageTiltStrength().set(value);
    }

    @Override
    public double fovEffects() {
        return mc().options.fovEffectScale().get();
    }

    @Override
    public void setFovEffects(double value) {
        mc().options.fovEffectScale().set(value);
    }

    @Override
    public double gamma() {
        return mc().options.gamma().get();
    }

    @Override
    public void setGamma(double value) {
        // The option itself refuses values above 1, so the field is set directly.
        ((OptionAccessor) (Object) mc().options.gamma()).setHammerValue(value);
    }

    @Override
    public boolean smoothCamera() {
        return mc().options.smoothCamera;
    }

    @Override
    public void setSmoothCamera(boolean on) {
        mc().options.smoothCamera = on;
    }

    @Override
    public int cameraMode() {
        return mc().options.getCameraType().ordinal();
    }

    @Override
    public void setCameraMode(int mode) {
        CameraType[] all = CameraType.values();
        mc().options.setCameraType(all[Math.max(0, Math.min(all.length - 1, mode))]);
    }

    @Override
    public boolean inGameFocus() {
        return screen() == null && mc().mouseHandler.isMouseGrabbed();
    }

    // ───────────── Game ─────────────

    private static LocalPlayer player() {
        Minecraft mc = mc();
        return mc.level == null ? null : mc.player;
    }

    @Override
    public boolean inWorld() {
        return player() != null;
    }

    @Override
    public int fps() {
        return mc().getFps();
    }

    @Override
    public String playerName() {
        return mc().getUser().getName();
    }

    @Override
    public double x() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getX();
    }

    @Override
    public double y() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getY();
    }

    @Override
    public double z() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getZ();
    }

    @Override
    public float yaw() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getYRot();
    }

    @Override
    public float pitch() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getXRot();
    }

    private String biome = "";
    private int biomeTick = -1;

    @Override
    public String biome() {
        LocalPlayer p = player();
        if (p == null) return "";
        if (biomeTick == ticks) return biome;
        biomeTick = ticks;
        biome = mc().level.getBiome(p.blockPosition()).unwrapKey().map(key -> {
            //#if MC >= 1.21.11
            Identifier id = key.identifier();
            //#else
            Identifier id = key.location();
            //#endif
            String k = "biome." + id.getNamespace() + "." + id.getPath();
            String name = Component.translatable(k).getString();
            return name.equals(k) ? id.getPath().replace('_', ' ') : name;
        }).orElse("");
        return biome;
    }

    @Override
    public int ping() {
        Minecraft mc = mc();
        LocalPlayer p = player();
        if (p == null || mc.getConnection() == null || mc.getCurrentServer() == null) return -1;
        PlayerInfo info = mc.getConnection().getPlayerInfo(p.getUUID());
        return info == null ? -1 : info.getLatency();
    }

    @Override
    public String server() {
        Minecraft mc = mc();
        return mc.getCurrentServer() == null || mc.getCurrentServer().ip == null ? "" : mc.getCurrentServer().ip;
    }

    @Override
    public long dayTime() {
        ClientLevel level = mc().level;
        if (level == null) return 0;
        readingRealTime = true; // the day counter and clock show the server's time, not the time changer's
        try {
            //#if MC >= 26.1
            return level.getDefaultClockTime();
            //#else
            return level.getDayTime();
            //#endif
        } finally {
            readingRealTime = false;
        }
    }

    @Override
    public float health() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getHealth();
    }

    @Override
    public float maxHealth() {
        LocalPlayer p = player();
        return p == null ? 20 : p.getMaxHealth();
    }

    @Override
    public int food() {
        LocalPlayer p = player();
        return p == null ? 20 : p.getFoodData().getFoodLevel();
    }

    @Override
    public float saturation() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getFoodData().getSaturationLevel();
    }

    @Override
    public int hurtTime() {
        LocalPlayer p = player();
        return p == null ? 0 : p.hurtTime;
    }

    @Override
    public boolean sprinting() {
        LocalPlayer p = player();
        return p != null && p.isSprinting();
    }

    @Override
    public boolean sneaking() {
        LocalPlayer p = player();
        return p != null && p.isShiftKeyDown();
    }

    @Override
    public int light() {
        LocalPlayer p = player();
        if (p == null) return 0;
        return mc().level.getLightEngine().getLayerListener(LightLayer.BLOCK).getLightValue(p.blockPosition());
    }

    @Override
    public int armor() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getArmorValue();
    }

    @Override
    public float absorption() {
        LocalPlayer p = player();
        return p == null ? 0 : p.getAbsorptionAmount();
    }

    @Override
    public Target target() {
        LocalPlayer p = player();
        if (p == null || !(mc().crosshairPickEntity instanceof LivingEntity e) || !e.isAlive()) return null;
        double distance = Math.sqrt(e.getBoundingBox().distanceToSqr(p.getEyePosition()));
        return new Target(e.getName().getString(), e.getHealth(), e.getMaxHealth(), distance, e instanceof Player);
    }

    private String block = "";
    private int blockTick = -1;

    @Override
    public String block() {
        Minecraft mc = mc();
        if (player() == null) return "";
        if (blockTick == ticks) return block;
        blockTick = ticks;
        block = mc.hitResult instanceof BlockHitResult hit && hit.getType() == HitResult.Type.BLOCK ? mc.level.getBlockState(hit.getBlockPos()).getBlock().getName().getString() : "";
        return block;
    }

    // The lists below are rebuilt once per game tick, not per frame.
    private List<Effect> effects = List.of();
    private int effectsTick = -1;
    private List<Item> equipment = List.of();
    private int equipmentTick = -1;
    private List<Item> inventory = List.of();
    private int inventoryTick = -1;

    @Override
    public List<Effect> effects() {
        LocalPlayer p = player();
        if (p == null) return List.of();
        if (effectsTick != ticks) {
            effectsTick = ticks;
            List<Effect> out = new ArrayList<>();
            for (MobEffectInstance e : p.getActiveEffects()) {
                MobEffect effect = e.getEffect().value();
                out.add(new Effect(effect.getDisplayName().getString(), e.getAmplifier(), e.getDuration(), e.isInfiniteDuration(), effect.getColor(), effect.isBeneficial()));
            }
            effects = out;
        }
        return effects;
    }

    private static Item item(ItemStack s) {
        if (s == null || s.isEmpty()) return Item.EMPTY;
        return new Item(s, BuiltInRegistries.ITEM.getKey(s.getItem()).toString(), s.getHoverName().getString(), s.getCount(), s.getDamageValue(), s.isDamageableItem() ? s.getMaxDamage() : 0);
    }

    @Override
    public List<Item> equipment() {
        LocalPlayer p = player();
        if (p == null) return List.of();
        if (equipmentTick != ticks) {
            equipmentTick = ticks;
            equipment = List.of(item(p.getItemBySlot(EquipmentSlot.HEAD)), item(p.getItemBySlot(EquipmentSlot.CHEST)), item(p.getItemBySlot(EquipmentSlot.LEGS)), item(p.getItemBySlot(EquipmentSlot.FEET)), item(p.getMainHandItem()), item(p.getOffhandItem()));
        }
        return equipment;
    }

    @Override
    public List<Item> inventory() {
        LocalPlayer p = player();
        if (p == null) return List.of();
        if (inventoryTick != ticks) {
            inventoryTick = ticks;
            List<Item> out = new ArrayList<>(36);
            for (int i = 0; i < 36; i++) out.add(item(p.getInventory().getItem(i)));
            inventory = out;
        }
        return inventory;
    }
}
