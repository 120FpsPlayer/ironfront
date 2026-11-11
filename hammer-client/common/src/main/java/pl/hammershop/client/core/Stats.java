package pl.hammershop.client.core;

import pl.hammershop.client.api.Game;
import pl.hammershop.client.api.Platform;

import java.util.ArrayDeque;
import java.util.Deque;

/** Small live measurements shared by the HUD modules: clicks per second, speed, combo, reach, server TPS, timers. */
public final class Stats {
    private final Deque<Long> left = new ArrayDeque<>();
    private final Deque<Long> right = new ArrayDeque<>();
    private boolean wasLeft;
    private boolean wasRight;

    private double lastX;
    private double lastZ;
    private boolean hasPos;
    private double speed;

    private int combo;
    private long lastHit;
    private int lastHurt;
    private double reach = -1;
    private long reachAt;
    private int targetId = -1;
    private int kills;
    private int deaths;
    private boolean alive = true;

    private long lastTimePacket;
    private double tps = 20;

    public final long sessionStart = System.currentTimeMillis();

    private boolean swRunning;
    private long swStart;
    private long swElapsed;

    /** Every frame while playing. */
    public void frame(Platform p) {
        boolean focus = p.inGameFocus();
        boolean l = focus && p.mouseHeld(0);
        boolean r = focus && p.mouseHeld(1);
        long now = System.currentTimeMillis();
        if (l && !wasLeft) left.addLast(now);
        if (r && !wasRight) right.addLast(now);
        wasLeft = l;
        wasRight = r;
    }

    /** 20 times per second. */
    public void tick(Platform p) {
        Game g = p.game();
        if (!g.inWorld()) {
            hasPos = false;
            combo = 0;
            targetId = -1;
            alive = true;
            return;
        }
        // A kill = something you hit died within a few seconds of your last hit (counted on your side).
        if (targetId != -1) {
            if (System.currentTimeMillis() - lastHit > 4000) targetId = -1;
            else if (p.entityDead(targetId)) {
                kills++;
                targetId = -1;
            }
        }
        boolean nowAlive = g.health() > 0;
        if (alive && !nowAlive) {
            deaths++;
            Waypoints.died(g);
        }
        alive = nowAlive;
        double dx = g.x() - lastX;
        double dz = g.z() - lastZ;
        lastX = g.x();
        lastZ = g.z();
        if (hasPos) {
            double now = Math.sqrt(dx * dx + dz * dz) * 20.0;
            speed = now > 150 ? 0 : speed * 0.6 + now * 0.4; // teleports don't count
        }
        hasPos = true;
        int hurt = g.hurtTime();
        if (hurt > lastHurt) combo = 0; // got hit
        lastHurt = hurt;
        if (combo > 0 && System.currentTimeMillis() - lastHit > 3000) combo = 0;
    }

    private static int count(Deque<Long> clicks) {
        long now = System.currentTimeMillis();
        while (!clicks.isEmpty() && now - clicks.peekFirst() > 1000) clicks.removeFirst();
        return clicks.size();
    }

    public int cpsLeft() {
        return count(left);
    }

    public int cpsRight() {
        return count(right);
    }

    public double speed() {
        return speed;
    }

    /** The player hit the entity with this id, `distance` blocks away. */
    public void attacked(double distance, int entityId) {
        combo++;
        lastHit = System.currentTimeMillis();
        reach = distance;
        reachAt = lastHit;
        targetId = entityId;
    }

    /** Milliseconds since the player's last hit. */
    public long sinceHit() {
        return System.currentTimeMillis() - lastHit;
    }

    public int kills() {
        return kills;
    }

    public int deaths() {
        return deaths;
    }

    public int combo() {
        return combo;
    }

    /** Distance of the last hit, or -1 when there was none in the last 5 seconds. */
    public double reach() {
        return System.currentTimeMillis() - reachAt < 5000 ? reach : -1;
    }

    /** The server's time packet arrived (it sends one per 20 server ticks). */
    public void timePacket() {
        long now = System.currentTimeMillis();
        if (lastTimePacket > 0) {
            long interval = now - lastTimePacket;
            if (interval > 200 && interval < 20000) tps = tps * 0.7 + Math.min(20.0, 20000.0 / interval) * 0.3;
        }
        lastTimePacket = now;
    }

    public double tps() {
        return System.currentTimeMillis() - lastTimePacket > 6000 ? -1 : tps;
    }

    public void leftWorld() {
        lastTimePacket = 0;
        tps = 20;
        combo = 0;
    }

    /** Start / stop; pressing again after a stop starts from zero. */
    public void stopwatchPress() {
        if (swRunning) {
            swElapsed += System.currentTimeMillis() - swStart;
            swRunning = false;
        } else {
            if (swElapsed > 0) swElapsed = 0;
            swStart = System.currentTimeMillis();
            swRunning = true;
        }
    }

    public long stopwatchMillis() {
        return swElapsed + (swRunning ? System.currentTimeMillis() - swStart : 0);
    }

    public boolean stopwatchRunning() {
        return swRunning;
    }
}
