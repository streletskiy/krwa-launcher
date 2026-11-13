package ru.krwa.controlify.mixin;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.gui.ComponentPath;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.function.BooleanSupplier;

@Mixin(value = ChatScreen.class, priority = 900)
abstract class ChatScreenMixin extends Screen {
    @Shadow protected EditBox input;

    protected ChatScreenMixin(Component title) {
        super(title);
    }

    // No Chat Reports limits focus to the edit box. Permit Controlify's keyboard too.
    @Inject(method = "setFocused(Lnet/minecraft/client/gui/components/events/GuiEventListener;)V",
            at = @At("HEAD"), cancellable = true, require = 0)
    private void krwa$allowKeyboardFocus(GuiEventListener element, CallbackInfo ci) {
        if (krwa$isKeyboard(element)) {
            super.setFocused(element);
            ci.cancel();
        }
    }

    @Inject(method = "changeFocus(Lnet/minecraft/client/gui/ComponentPath;)V",
            at = @At("HEAD"), cancellable = true, require = 0)
    private void krwa$allowKeyboardNavigation(ComponentPath path, CallbackInfo ci) {
        if (path instanceof ComponentPath.Path root && krwa$isKeyboard(root.childPath().component())) {
            super.changeFocus(path);
            ci.cancel();
        }
    }

    @Inject(method = "controlify$acceptChar(CI)Z", at = @At("HEAD"), cancellable = true, require = 0)
    private void krwa$typeFromControlify(char character, int modifiers, CallbackInfoReturnable<Boolean> cir) {
        if (input != null) {
            cir.setReturnValue(krwa$edit(() -> input.charTyped(character, modifiers)));
        }
    }

    @Inject(method = "controlify$acceptKeyCode(III)Z", at = @At("HEAD"), cancellable = true, require = 0)
    private void krwa$editFromControlify(int key, int scanCode, int modifiers, CallbackInfoReturnable<Boolean> cir) {
        // Keep Controlify's normal submit/cancel behavior and vanilla's chat signing path.
        if (input != null && key != InputConstants.KEY_RETURN && key != InputConstants.KEY_ESCAPE) {
            cir.setReturnValue(krwa$edit(() -> input.keyPressed(key, scanCode, modifiers)));
        }
    }

    // Steam's keyboard and a physical keyboard send normal Minecraft key/character events.
    @Override
    public boolean charTyped(char character, int modifiers) {
        if (input != null && krwa$isKeyboard(getFocused())) {
            return krwa$edit(() -> input.charTyped(character, modifiers));
        }
        return super.charTyped(character, modifiers);
    }

    @Inject(method = "keyPressed", at = @At("RETURN"), cancellable = true)
    private void krwa$editFromSystemKeyboard(int key, int scanCode, int modifiers, CallbackInfoReturnable<Boolean> cir) {
        if (!cir.getReturnValue() && input != null && krwa$isKeyboard(getFocused())) {
            cir.setReturnValue(krwa$edit(() -> input.keyPressed(key, scanCode, modifiers)));
        }
    }

    @Unique
    private static boolean krwa$isKeyboard(GuiEventListener element) {
        // Controlify is optional in the pack.
        return element != null && element.getClass().getName().equals("dev.isxander.controlify.screenop.keyboard.KeyboardWidget");
    }

    @Unique
    private boolean krwa$edit(BooleanSupplier action) {
        boolean focused = input.isFocused();
        if (!focused) input.setFocused(true);
        try {
            return action.getAsBoolean();
        } finally {
            if (!focused) input.setFocused(false);
        }
    }
}
