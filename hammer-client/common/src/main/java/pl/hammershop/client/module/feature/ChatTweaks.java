package pl.hammershop.client.module.feature;

import pl.hammershop.client.module.Module;
import pl.hammershop.client.module.Setting;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

/** Chat helpers: the time in front of every message (click it to copy the message) and a much longer history. */
public final class ChatTweaks extends Module {
    private static final DateTimeFormatter SHORT = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("HH:mm:ss");

    private final Setting.Bool timestamps = bool("timestamps", true);
    private final Setting.Bool seconds = bool("seconds", false);
    private final Setting.Bool copy = bool("click_to_copy", true);
    private final Setting.Bool history = bool("long_history", true);

    public ChatTweaks() {
        super("chat", "chat", Category.GAMEPLAY, false);
    }

    /** "[12:34] " for a message that arrives now, or null when the time is switched off. */
    public String prefix() {
        if (!timestamps.on()) return null;
        return "[" + LocalTime.now().format(seconds.on() ? LONG : SHORT) + "] ";
    }

    public boolean clickToCopy() {
        return copy.on();
    }

    public boolean longHistory() {
        return history.on();
    }
}
