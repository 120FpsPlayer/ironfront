package pl.hammershop.client.preview;

import pl.hammershop.client.api.Gfx;

import javax.imageio.ImageIO;
import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Font;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;

/** Offline renderer: draws a frame of the Hammer UI into an image with Java2D, so screens can be checked without the game. */
public final class Java2DGfx implements Gfx {
    private static final Map<String, BufferedImage> TEXTURES = new HashMap<>();
    private static final Map<String, BufferedImage> TINTED = new HashMap<>();

    public final BufferedImage image;
    private final Graphics2D g;
    private final double scale;
    private final AffineTransform base;
    private final Deque<AffineTransform> stack = new ArrayDeque<>();
    private final Deque<int[]> clips = new ArrayDeque<>();
    private final Font mcFont = new Font(Font.MONOSPACED, Font.BOLD, 8);

    public Java2DGfx(int realW, int realH, double guiScale) {
        image = new BufferedImage(realW, realH, BufferedImage.TYPE_INT_ARGB);
        g = image.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_OFF);
        scale = guiScale;
        g.scale(guiScale, guiScale);
        base = g.getTransform();
    }

    public void save(File file) throws java.io.IOException {
        file.getParentFile().mkdirs();
        ImageIO.write(image, "png", file);
    }

    @Override
    public int width() {
        return (int) (image.getWidth() / scale);
    }

    @Override
    public int height() {
        return (int) (image.getHeight() / scale);
    }

    @Override
    public double guiScale() {
        return scale;
    }

    @Override
    public void fill(int x1, int y1, int x2, int y2, int argb) {
        g.setColor(new Color(argb, true));
        g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }

    @Override
    public void gradient(int x1, int y1, int x2, int y2, int top, int bottom) {
        g.setPaint(new GradientPaint(0, y1, new Color(top, true), 0, y2, new Color(bottom, true)));
        g.fillRect(x1, y1, x2 - x1, y2 - y1);
    }

    private static BufferedImage texture(String name) {
        return TEXTURES.computeIfAbsent(name, n -> {
            try (InputStream in = Java2DGfx.class.getResourceAsStream("/assets/hammerclient/textures/" + n + ".png")) {
                if (in == null) throw new IllegalStateException("Missing texture " + n);
                BufferedImage src = ImageIO.read(in);
                BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB);
                out.getGraphics().drawImage(src, 0, 0, null);
                return out;
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
        });
    }

    private static BufferedImage tinted(String name, int rgb) {
        if ((rgb & 0xFFFFFF) == 0xFFFFFF) return texture(name);
        if (TINTED.size() > 400) TINTED.clear();
        return TINTED.computeIfAbsent(name + "#" + (rgb & 0xFFFFFF), k -> {
            BufferedImage src = texture(name);
            BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB);
            int r = (rgb >> 16) & 0xFF;
            int gg = (rgb >> 8) & 0xFF;
            int b = rgb & 0xFF;
            for (int y = 0; y < src.getHeight(); y++) {
                for (int x = 0; x < src.getWidth(); x++) {
                    int p = src.getRGB(x, y);
                    int pr = ((p >> 16) & 0xFF) * r / 255;
                    int pg = ((p >> 8) & 0xFF) * gg / 255;
                    int pb = (p & 0xFF) * b / 255;
                    out.setRGB(x, y, (p & 0xFF000000) | (pr << 16) | (pg << 8) | pb);
                }
            }
            return out;
        });
    }

    @Override
    public void image(String texture, int x, int y, int w, int h, float u, float v, int uw, int vh, int texW, int texH, int argb) {
        BufferedImage tex = tinted(texture, argb);
        if (tex.getWidth() != texW || tex.getHeight() != texH) throw new IllegalStateException(texture + " is " + tex.getWidth() + "x" + tex.getHeight() + ", not " + texW + "x" + texH);
        float alpha = ((argb >>> 24) & 0xFF) / 255f;
        if (alpha <= 0 || w <= 0 || h <= 0) return;
        java.awt.Composite old = g.getComposite();
        if (alpha < 1f) g.setComposite(AlphaComposite.SrcOver.derive(alpha));
        g.drawImage(tex, x, y, x + w, y + h, Math.round(u), Math.round(v), Math.round(u + uw), Math.round(v + vh), null);
        g.setComposite(old);
    }

    @Override
    public int mcTextWidth(String text) {
        return (int) Math.ceil(text.length() * 5.6);
    }

    @Override
    public void mcText(String text, int x, int y, int argb, boolean shadow) {
        g.setFont(mcFont);
        float step = 5.6f;
        for (int pass = shadow ? 0 : 1; pass < 2; pass++) {
            g.setColor(pass == 0 ? new Color(((argb >>> 24) << 24) | 0x3F3F3F & 0xFFFFFF | ((argb >>> 24) << 24), true) : new Color(argb, true));
            int o = pass == 0 ? 1 : 0;
            for (int i = 0; i < text.length(); i++) g.drawString(String.valueOf(text.charAt(i)), x + o + i * step, y + o + 7);
        }
    }

    @Override
    public void item(Object stack, int x, int y) {
        int hash = String.valueOf(stack).hashCode();
        Color c = Color.getHSBColor((hash & 0xFF) / 255f, 0.45f, 0.85f);
        g.setColor(c.darker());
        g.fillRoundRect(x + 1, y + 1, 14, 14, 4, 4);
        g.setColor(c);
        g.fillRoundRect(x + 2, y + 2, 12, 9, 3, 3);
    }

    @Override
    public void push() {
        stack.push(g.getTransform());
    }

    @Override
    public void pop() {
        g.setTransform(stack.pop());
    }

    @Override
    public void translate(float x, float y) {
        g.translate(x, y);
    }

    @Override
    public void scale(float sx, float sy) {
        g.scale(sx, sy);
    }

    private void applyClip() {
        AffineTransform cur = g.getTransform();
        g.setTransform(base);
        int[] c = clips.peek();
        g.setClip(c == null ? null : new Rectangle(c[0], c[1], c[2] - c[0], c[3] - c[1]));
        g.setTransform(cur);
    }

    @Override
    public void clip(int x1, int y1, int x2, int y2) {
        clips.push(new int[] {x1, y1, x2, y2});
        applyClip();
    }

    @Override
    public void unclip() {
        clips.pop();
        applyClip();
    }
}
