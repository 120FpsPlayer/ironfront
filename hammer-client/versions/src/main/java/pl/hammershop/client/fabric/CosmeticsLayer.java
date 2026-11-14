package pl.hammershop.client.fabric;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.entity.RenderLayerParent;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.Items;
import org.joml.Matrix4f;
import pl.hammershop.client.core.Cosmetics;
import pl.hammershop.client.core.Log;

import java.util.HashMap;
import java.util.Map;
//#if MC >= 1.21.11
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.rendertype.RenderTypes;
//#else
import net.minecraft.client.model.PlayerModel;
import net.minecraft.client.renderer.RenderType;
//#endif
//#if MC >= 1.21.9
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
//#elif MC >= 1.21.2
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.entity.state.PlayerRenderState;
//#else
import net.minecraft.client.renderer.MultiBufferSource;
//#endif

/**
 * Dodatki (Hammer+) on the player model: wings on the back, a halo above the head, a hat on it. A layer of the
 * player renderer like the cape, so everything follows the bones – sneaking, looking up and down, the inventory
 * preview. Not drawn for invisible players (and the game draws no player layers in first person or for spectators);
 * the hat stays off while a helmet is worn, the wings while an elytra is. The boxes come ready from {@link Cosmetics};
 * each frame only moves them (one matrix per part) and writes their vertices – no textures or buffers are made here.
 */
//#if MC >= 1.21.9
public final class CosmeticsLayer extends RenderLayer<AvatarRenderState, PlayerModel> {
//#elif MC >= 1.21.2
public final class CosmeticsLayer extends RenderLayer<PlayerRenderState, PlayerModel> {
//#else
public final class CosmeticsLayer extends RenderLayer<AbstractClientPlayer, PlayerModel<AbstractClientPlayer>> {
//#endif
    private static final int FULL_BRIGHT = 0xF000F0;
    /** Only touched on the render thread: one animation and one matrix reused for every part. */
    private static final float[] MOVE = new float[6];
    private static final Matrix4f TURN = new Matrix4f();
    private static boolean failed;
    private final Map<String, RenderType> types = new HashMap<>();

    //#if MC >= 1.21.9
    public CosmeticsLayer(RenderLayerParent<AvatarRenderState, PlayerModel> parent) {
    //#elif MC >= 1.21.2
    public CosmeticsLayer(RenderLayerParent<PlayerRenderState, PlayerModel> parent) {
    //#else
    public CosmeticsLayer(RenderLayerParent<AbstractClientPlayer, PlayerModel<AbstractClientPlayer>> parent) {
    //#endif
        super(parent);
    }

    //#if MC >= 1.21.9
    @Override
    public void submit(PoseStack pose, SubmitNodeCollector out, int light, AvatarRenderState state, float yRot, float xRot) {
        if (!state.isInvisible) draw(pose, out, light, player(state.id), state.ageInTicks);
    }
    //#elif MC >= 1.21.2
    @Override
    public void render(PoseStack pose, MultiBufferSource out, int light, PlayerRenderState state, float yRot, float xRot) {
        if (!state.isInvisible) draw(pose, out, light, player(state.id), state.ageInTicks);
    }
    //#else
    @Override
    public void render(PoseStack pose, MultiBufferSource out, int light, AbstractClientPlayer player, float limbSwing, float limbSwingAmount, float partialTick, float ageInTicks, float headYaw, float headPitch) {
        if (!player.isInvisible()) draw(pose, out, light, player, ageInTicks);
    }
    //#endif

    /** The player a render state was made from (other entities drawn like players – mannequins – get nothing). */
    private static AbstractClientPlayer player(int id) {
        var level = Minecraft.getInstance().level;
        return level != null && level.getEntity(id) instanceof AbstractClientPlayer p ? p : null;
    }

    //#if MC >= 1.21.9
    private void draw(PoseStack pose, SubmitNodeCollector out, int light, AbstractClientPlayer player, float ticks) {
    //#else
    private void draw(PoseStack pose, MultiBufferSource out, int light, AbstractClientPlayer player, float ticks) {
    //#endif
        if (player == null || failed) return;
        try {
            FabricPlatform.Worn worn = FabricPlatform.worn(player, ticks);
            if (worn == null) return;
            Cosmetics.Look look = worn.look();
            HumanoidModel<?> model = getParentModel();
            if (look.wings() != null && !player.getItemBySlot(EquipmentSlot.CHEST).is(Items.ELYTRA)) item(pose, out, light, model, Cosmetics.item(look.wings()), ticks, worn.flight(), 0);
            Cosmetics.Item hat = look.hat() != null && player.getItemBySlot(EquipmentSlot.HEAD).isEmpty() ? Cosmetics.item(look.hat()) : null;
            if (hat != null) item(pose, out, light, model, hat, ticks, 0, 0);
            // the halo floats above the hat
            if (look.halo()) item(pose, out, light, model, Cosmetics.item(Cosmetics.HALO), ticks, 0, Cosmetics.haloLift(hat));
        } catch (RuntimeException e) {
            // a cosmetic must never take the game down: they are switched off for this session instead
            failed = true;
            Log.warn("Nie udało się narysować dodatków – wyłączam je do końca gry", e);
        }
    }

    //#if MC >= 1.21.9
    private void item(PoseStack pose, SubmitNodeCollector out, int light, HumanoidModel<?> model, Cosmetics.Item item, float ticks, float flight, float lift) {
    //#else
    private void item(PoseStack pose, MultiBufferSource out, int light, HumanoidModel<?> model, Cosmetics.Item item, float ticks, float flight, float lift) {
    //#endif
        if (item == null) return;
        RenderType type = types.computeIfAbsent(item.id, id -> renderType(item));
        int l = item.glow ? FULL_BRIGHT : light;
        for (Cosmetics.Part part : item.parts) {
            pose.pushPose();
            (part.bone == Cosmetics.Bone.HEAD ? model.head : model.body).translateAndRotate(pose);
            Cosmetics.animate(part, ticks, flight, MOVE);
            TURN.identity().translate(part.px + MOVE[0], part.py + MOVE[1] + lift, part.pz + MOVE[2]).rotateZYX(MOVE[5], MOVE[4], MOVE[3]);
            pose.mulPose(TURN);
            float[] quads = part.quads;
            //#if MC >= 1.21.9
            out.submitCustomGeometry(pose, type, (p, vc) -> vertices(p, vc, quads, l));
            //#else
            vertices(pose.last(), out.getBuffer(type), quads, l);
            //#endif
            pose.popPose();
        }
    }

    private static void vertices(PoseStack.Pose pose, VertexConsumer vc, float[] q, int light) {
        for (int i = 0; i < q.length; i += Cosmetics.STRIDE) {
            vc.addVertex(pose, q[i], q[i + 1], q[i + 2]).setColor(-1).setUv(q[i + 3], q[i + 4]).setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(pose, q[i + 5], q[i + 6], q[i + 7]);
        }
    }

    /** Cut-out and drawn from both sides (flat wings, the inside of a hat); the halo glows and may be see-through. */
    private static RenderType renderType(Cosmetics.Item item) {
        Identifier texture = Identifier.fromNamespaceAndPath("hammerclient", item.texture());
        //#if MC >= 26.1
        return item.glow ? RenderTypes.entityTranslucentEmissive(texture) : RenderTypes.entityCutout(texture);
        //#elif MC >= 1.21.11
        return item.glow ? RenderTypes.entityTranslucentEmissive(texture) : RenderTypes.entityCutoutNoCull(texture);
        //#else
        return item.glow ? RenderType.entityTranslucentEmissive(texture) : RenderType.entityCutoutNoCull(texture);
        //#endif
    }
}
