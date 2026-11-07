package org.magictester.engine;
public final class EngineProbe {
    public static void main(String[] args) throws Exception {
        AndroidForgeBridge.initialize(args[0], System.out::println);
        AndroidForgeBridge.execute(java.nio.file.Files.readString(java.nio.file.Path.of(args[1])), System.out::println);
        System.exit(0);
    }
}
