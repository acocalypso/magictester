/* SPDX-License-Identifier: GPL-3.0-only */
package org.magictester.ai;

import java.util.concurrent.CancellationException;
import java.util.concurrent.Future;

/** Cooperative cancellation, with process-level failure when an evaluator cannot stop. */
public final class AiCancellation {
    private AiCancellation() {}
    public static final class EvaluationAborted extends IllegalStateException {
        public EvaluationAborted(String message) {super(message);}
    }
    public static void checkpoint() {
        if(Thread.currentThread().isInterrupted()) throw new CancellationException("Forge evaluation interrupted");
    }
    public static void cancelAndJoin(Future<?> evaluation,Thread worker) {cancelAndJoin(evaluation,worker,2000);}
    static void cancelAndJoin(Future<?> evaluation,Thread worker,long graceMillis) {
        if(graceMillis<1 || graceMillis>2000 || worker==Thread.currentThread()) throw new IllegalArgumentException("Invalid cancellation join");
        evaluation.cancel(true);worker.interrupt();
        try {worker.join(graceMillis);}
        catch(InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new EvaluationAborted("The game was interrupted while waiting for its AI evaluator to stop.");
        }
        if(worker.isAlive()) throw new EvaluationAborted("An AI evaluator ignored cancellation; the isolated game must stop.");
        if(Thread.currentThread().isInterrupted()) throw new EvaluationAborted("The game was interrupted during AI evaluation.");
    }
}
