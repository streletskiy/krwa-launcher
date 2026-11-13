# KRWA Controlify Chat

Client-side compatibility for Minecraft 1.21.1, NeoForge 21.1.250, Controlify 3.0.1 LTS and No Chat Reports 2.9.1. The mod allows Controlify's keyboard widget to receive navigation focus and lets its key events reach the chat edit box. The existing Minecraft chat submission and No Chat Reports hooks still run. The keyboard layout adds an explicit Cyrillic switch.

Build on Windows with Java 21. The Minecraft client and Mixin JARs are available in the launcher's common libraries after installing the Aeronautics profile:

```powershell
.\client-mods\krwa-controlify-chat\build.ps1 `
  -MinecraftClientJar '<common>\libraries\net\minecraft\client\1.21.1-20240808.144430\client-1.21.1-20240808.144430-srg.jar' `
  -MixinJar '<common>\libraries\net\fabricmc\sponge-mixin\0.15.2+mixin.0.8.7\sponge-mixin-0.15.2+mixin.0.8.7.jar' `
  -OutputJar 'repository\repo\mods\krwa-controlify-chat-1.0.0.jar'
```

When updating the mod, publish under a new versioned filename and update its size, MD5 and path in the profile's NeoForge lock before rebuilding the distribution. Recheck the chat mixins when updating Controlify or No Chat Reports.
