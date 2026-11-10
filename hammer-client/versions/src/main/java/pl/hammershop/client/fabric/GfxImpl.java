package pl.hammershop.client.fabric;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;
import pl.hammershop.client.api.Gfx;

import java.util.HashMap;
import java.util.Map;
//#if MC >= 1.21.6
import net.minecraft.client.renderer.RenderPipelines;
//#elif MC >= 1.21.2
import net.minecraft.client.renderer.RenderType;
//#else
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.MeshData;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.renderer.GameRenderer;
import org.joml.Matrix4f;
//#endif

/** {@link Gfx} on the game's own GUI drawing of this Minecraft version. One instance, re-aimed every frame. */
final class GfxImpl implements Gfx {
    private static final Map<String, Identifier> TEXTURES = new HashMap<>();
    private GuiGraphicsExtractor g;
    private Minecraft mc;

    void begin(GuiGraphicsExtractor graphics) {
        g = graphics;
        mc = Minecraft.getInstance();
    }

    /** Must be called when the frame's drawing is done. */
    void end() {
        flush();
        g = null;
    }

    private static Identifier id(String texture) {
        return TEXTURES.computeIfAbsent(texture, t -> Identifier.fromNamespaceAndPath("hammerclient", "textures/" + t + ".png"));
    }

    @Override
    public int width() {
        return g.guiWidth();
    }

    @Override
    public int height() {
        return g.guiHeight();
    }

    @Override
    public double guiScale() {
        return (double) mc.getWindow().getGuiScale();
    }

    @Override
    public void fill(int x1, int y1, int x2, int y2, int argb) {
        flush();
        g.fill(x1, y1, x2, y2, argb);
    }

    @Override
    public void gradient(int x1, int y1, int x2, int y2, int argbTop, int argbBottom) {
        flush();
        g.fillGradient(x1, y1, x2, y2, argbTop, argbBottom);
    }

    //#if MC >= 1.21.2
    private void flush() {
        // the game batches for us
    }

    @Override
    public void image(String texture, int x, int y, int w, int h, float u, float v, int uw, int vh, int texW, int texH, int argb) {
        //#if MC >= 1.21.6
        g.blit(RenderPipelines.GUI_TEXTURED, id(texture), x, y, u, v, w, h, uw, vh, texW, texH, argb);
        //#else
        g.blit(RenderType::guiTextured, id(texture), x, y, u, v, w, h, uw, vh, texW, texH, argb);
        //#endif
    }
    //#else
    // 1.21 / 1.21.1 draws every image on its own; we collect the ones that share a texture and a tint into one
    // draw call. The tint goes in as the shader colour: the per-vertex-colour shader of these versions throws away
    // everything below 10% opacity, which would cut holes into soft shadows and glows.
    private BufferBuilder batch;
    private Identifier batchTexture;
    private int batchColor;

    private void flush() {
        if (batch == null) return;
        MeshData mesh = batch.build();
        batch = null;
        if (mesh == null) return;
        int c = batchColor;
        RenderSystem.setShaderTexture(0, batchTexture);
        RenderSystem.setShader(GameRenderer::getPositionTexShader);
        RenderSystem.setShaderColor(((c >> 16) & 255) / 255f, ((c >> 8) & 255) / 255f, (c & 255) / 255f, (c >>> 24) / 255f);
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        BufferUploader.drawWithShader(mesh);
        RenderSystem.setShaderColor(1f, 1f, 1f, 1f);
    }

    @Override
    public void image(String texture, int x, int y, int w, int h, float u, float v, int uw, int vh, int texW, int texH, int argb) {
        Identifier id = id(texture);
        if (batch == null || argb != batchColor || !id.equals(batchTexture)) {
            flush();
            batchTexture = id;
            batchColor = argb;
            batch = Tesselator.getInstance().begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_TEX);
        }
        Matrix4f m = g.pose().last().pose();
        float u0 = u / texW;
        float u1 = (u + uw) / texW;
        float v0 = v / texH;
        float v1 = (v + vh) / texH;
        batch.addVertex(m, x, y, 0).setUv(u0, v0);
        batch.addVertex(m, x, y + h, 0).setUv(u0, v1);
        batch.addVertex(m, x + w, y + h, 0).setUv(u1, v1);
        batch.addVertex(m, x + w, y, 0).setUv(u1, v0);
    }
    //#endif

    @Override
    public int mcTextWidth(String text) {
        return mc.font.width(text);
    }

    @Override
    public void mcText(String text, int x, int y, int argb, boolean shadow) {
        flush();
        //#if MC >= 26.1
        g.text(mc.font, text, x, y, argb, shadow);
        //#else
        g.drawString(mc.font, text, x, y, argb, shadow);
        //#endif
    }

    @Override
    public void item(Object stack, int x, int y) {
        if (!(stack instanceof ItemStack item)) return;
        flush();
        //#if MC >= 26.1
        g.item(item, x, y);
        //#else
        g.renderItem(item, x, y);
        //#endif
    }

    @Override
    public void push() {
        //#if MC >= 1.21.6
        g.pose().pushMatrix();
        //#else
        g.pose().pushPose();
        //#endif
    }

    @Override
    public void pop() {
        //#if MC >= 1.21.6
        g.pose().popMatrix();
        //#else
        g.pose().popPose();
        //#endif
    }

    @Override
    public void translate(float x, float y) {
        //#if MC >= 1.21.6
        g.pose().translate(x, y);
        //#else
        g.pose().translate(x, y, 0f);
        //#endif
    }

    @Override
    public void scale(float sx, float sy) {
        //#if MC >= 1.21.6
        g.pose().scale(sx, sy);
        //#else
        g.pose().scale(sx, sy, 1f);
        //#endif
    }

    @Override
    public void clip(int x1, int y1, int x2, int y2) {
        flush();
        // Our rectangle is already in screen space; newer versions would transform it once more.
        //#if MC >= 1.21.6
        g.pose().pushMatrix();
        g.pose().identity();
        g.enableScissor(x1, y1, x2, y2);
        g.pose().popMatrix();
        //#elif MC >= 1.21.2
        g.pose().pushPose();
        g.pose().setIdentity();
        g.enableScissor(x1, y1, x2, y2);
        g.pose().popPose();
        //#else
        g.enableScissor(x1, y1, x2, y2);
        //#endif
    }

    @Override
    public void unclip() {
        flush();
        g.disableScissor();
    }
}
