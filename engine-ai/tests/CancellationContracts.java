/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class CancellationContracts {
    static void check(boolean ok,String message) {if(!ok)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception {
        Thread.currentThread().interrupt();
        try {AiCancellation.checkpoint();throw new AssertionError("Interrupt ignored");}
        catch(CancellationException expected) {check(Thread.currentThread().isInterrupted(),"Checkpoint preserves interrupt status");}
        finally {Thread.interrupted();}
        var started=new CountDownLatch(1);var mutations=new AtomicInteger();
        var cooperative=new FutureTask<Void>(()->{started.countDown();while(true) {AiCancellation.checkpoint();mutations.incrementAndGet();}});
        var worker=new Thread(cooperative,"cooperative-contract");worker.setDaemon(true);worker.start();check(started.await(1,TimeUnit.SECONDS),"Worker started");
        AiCancellation.cancelAndJoin(cooperative,worker,500);
        check(!worker.isAlive() && cooperative.isCancelled(),"No mutating worker survives successful cancellation");
        var release=new CountDownLatch(1);var ready=new CountDownLatch(1);
        var stubborn=new FutureTask<Void>(()->{ready.countDown();while(true) {try {release.await();return null;}catch(InterruptedException ignored) {}}});
        var stuck=new Thread(stubborn,"noncooperative-contract");stuck.setDaemon(true);stuck.start();check(ready.await(1,TimeUnit.SECONDS),"Stubborn worker started");
        try {AiCancellation.cancelAndJoin(stubborn,stuck,50);throw new AssertionError("Continuing a game with a live evaluator is forbidden");}
        catch(AiCancellation.EvaluationAborted expected) {check(stuck.isAlive(),"Failure reports the actual live worker");}
        finally {release.countDown();stuck.join(1000);}
        check(!stuck.isAlive(),"Test releases its worker");
        System.out.println("AI cancellation contracts passed");
    }
}
