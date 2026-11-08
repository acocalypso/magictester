/* SPDX-License-Identifier: GPL-3.0-only */
import org.magictester.ai.AiPolicies;
import java.util.*;
public final class AiPolicyContracts {
    static void check(boolean ok,String message) {if(!ok)throw new AssertionError(message);}
    static void rejects(String[] policies,int seats) {
        try {AiPolicies.validate(policies,seats);throw new AssertionError("Invalid policy accepted");}
        catch(IllegalArgumentException expected) {}
    }
    public static void main(String[] args) {
        check(AiPolicies.validate(null,4).equals(List.of("stable","stable","stable","stable")),"Existing requests stay stable");
        check(AiPolicies.validate(new String[]{"tactical-v1","stable"},2).get(1).equals("stable"),"Policies are per seat");
        rejects(new String[]{"tactical-v1"},2);rejects(new String[]{"strongest","stable"},2);
        check(AiPolicies.validate(new String[]{"tactical-v2","stable"},2).get(0).equals("tactical-v2"),"Expanded policy is versioned separately");rejects(new String[]{null,"stable"},2);
        check(AiPolicies.validate(new String[]{"strategic-v1","stable"},2).get(0).equals("strategic-v1"),"Strategic policy has a separate identity");
        String[] input={"tactical-v1","stable"};var frozen=AiPolicies.validate(input,2);input[0]="stable";
        check(frozen.get(0).equals("tactical-v1"),"Caller mutation cannot change selected policies");
        try {frozen.set(0,"stable");throw new AssertionError("Mutable policy list");}catch(UnsupportedOperationException expected) {}
        System.out.println("AI policy contracts passed");
    }
}
