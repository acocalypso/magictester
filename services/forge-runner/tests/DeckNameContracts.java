/* SPDX-License-Identifier: GPL-3.0-only
 * Native loader checks. These assertions are not played games.
 */
import forge.GuiDesktop;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.deck.DeckSection;
import forge.deck.io.DeckSerializer;
import java.nio.file.*;
public class DeckNameContracts {
    public static void main(String[] args) {
        try {
            System.setProperty("java.awt.headless","true");GuiBase.setInterface(new GuiDesktop());FModel.initialize(null,null);
            Path path=Files.createTempFile("deck-names-", ".dck");
            try {
                Files.writeString(path,"[metadata]\nName=Card name contract\n[Main]\n4 Tithing Blade\n4 Sagu Wildling\n1 Fire // Ice\n[Sideboard]\n1 Valakut Awakening\n[Commander]\n1 Esika, God of the Tree\n");
                var deck=DeckSerializer.fromFile(path.toFile());
                if(deck==null)throw new AssertionError("Native deck failed to load");
                int count=0;boolean split=false;
                for(var section:deck)for(var entry:section.getValue()){
                    if(entry.getKey().getRules().isUnsupported())throw new AssertionError("Unsupported native name: "+entry.getKey().getName());
                    if(entry.getKey().getName().equals("Fire // Ice"))split=true;
                    count+=entry.getValue();
                }
                if(!split)throw new AssertionError("The complete split card identity was lost");
                if(count!=11)throw new AssertionError("Card quantities changed: "+count);
                if(deck.getMain().countAll()!=9||deck.get(DeckSection.Sideboard).countAll()!=1||deck.get(DeckSection.Commander).countAll()!=1)throw new AssertionError("Deck sections changed");
                System.out.println("{\"event\":\"deck_name_contract_passed\",\"cards\":11,\"splitPreserved\":true}");
            }finally{Files.deleteIfExists(path);}
            System.exit(0);
        }catch(Throwable error){error.printStackTrace();System.exit(1);}
    }
}
