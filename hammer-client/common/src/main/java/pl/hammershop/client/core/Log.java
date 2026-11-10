package pl.hammershop.client.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class Log {
    private static final Logger LOG = LoggerFactory.getLogger("Hammer Client");

    private Log() {
    }

    public static void info(String message) {
        LOG.info("[Hammer Client] {}", message);
    }

    public static void warn(String message, Throwable t) {
        LOG.warn("[Hammer Client] " + message, t);
    }
}
