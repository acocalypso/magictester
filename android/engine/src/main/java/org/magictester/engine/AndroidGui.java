package org.magictester.engine;

import forge.gui.interfaces.IGuiBase;
import java.lang.reflect.Proxy;
import java.io.File;
import java.util.List;

/** No Swing, graphics backend, human choices, audio or network game services. */
public final class AndroidGui {
    public static IGuiBase create(String assets) {
        String root = new File(assets).getAbsolutePath() + File.separator;
        return (IGuiBase) Proxy.newProxyInstance(IGuiBase.class.getClassLoader(), new Class<?>[]{IGuiBase.class}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "getAssetsDir": return root;
                case "getCurrentVersion": return EngineVersion.VALUE;
                case "isRunningOnDesktop": case "isLibgdxPort": case "isGuiThread": case "hasNetGame": case "isSupportedAudioFormat": return false;
                case "getAvatarCount": case "getSleevesCount": return 1;
                case "getScreenScale": return 1f;
                case "encodeSymbols": return args[0];
                case "invokeInEdtNow": case "invokeInEdtLater": case "invokeInEdtAndWait": case "runBackgroundTask":
                    for (Object arg : args) if (arg instanceof Runnable) ((Runnable)arg).run();
                    return null;
                case "getChoices": case "order": case "chooseCard": case "showOptionDialog": case "showInputDialog":
                    throw new IllegalStateException("A headless AI game requested a human decision: " + method.getName());
                case "toString": return "MagicTester Android headless GUI";
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == args[0];
                default:
                    if (method.getReturnType() == void.class) return null;
                    if (method.getReturnType() == boolean.class) return false;
                    if (method.getReturnType() == int.class) return 0;
                    return null;
            }
        });
    }
}
