'use strict';

/**
 * Does a ticket message ask for a real person? The AI assistant's safety net: when it does, the bot calls the team
 * itself – without asking the model – and the assistant goes quiet in that ticket.
 *
 * Catches the usual ways to say it, with or without Polish letters: „chcę rozmawiać z człowiekiem”, „prawdziwa osoba”,
 * „ktoś z zespołu”, „zawołaj admina”, „potrzebuję moderatora”, a bare „admin” / „administracja”… A word like „admin”
 * counts only with a request around it (or in a very short message), so „jak zostać adminem?” doesn't call anyone.
 */

const fold = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9\s?!.,+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** On their own they mean "a person, please". */
const STRONG = [
  /\bczlowiek\w*|\bczlowieczk\w*/,
  /\bprawdziw\w* (osob\w*|ludz\w*|admin\w*|pracownik\w*|konsultant\w*|support\w*)/,
  /\bzyw\w* (osob\w*|czlowiek\w*|ludz\w*)/,
  /\b(ktos|kogos|kims|ktokolwiek) (z|ze) (zespolu|ekipy|administracji|supportu|obslugi|teamu|staffu|moderacji|wlascicieli)/,
  /\b(rozmawiac|porozmawiac|pogadac|gadac|pisac|napisac|kontakt\w*) (z|ze) (admin\w*|moderator\w*|modem|wlasciciel\w*|zespol\w*|supportem|obsluga|osoba|kims|ceo|ownerem|staffem|ekipa|pracownikiem)/,
  /\bnie (chce|bede|zamierzam) (rozmawiac|gadac|pisac) (z|ze) (bot\w*|ai|sztuczn\w*|automat\w*|maszyn\w*)/,
  /\b(chce|chcialbym|chcialabym|prosze o|poprosze o|potrzebuje) (rozmow\w*|kontakt\w*) (z|ze) /,
  /\b(talk|speak|chat) (to|with) (a |an )?(human|person|real|admin|staff|moderator|someone)/,
  /\breal (person|human)\b|\bhuman please\b/,
];

/** Who they may ask for… */
const ROLE = /\b(admin|admina|adminie|adminem|adminow|admini|adminy|administrac\w*|administrator\w*|moderator\w*|moderac\w*|moda|modow|wlasciciel\w*|ceo|owner\w*|staff\w*|zespol|zespolu|zespole|zespolem)\b/;
/** …and how they ask. */
const ASK = /\b(chce|chcialbym|chcialabym|potrzebuje|potrzebny|potrzebna|potrzeba|prosze|poprosze|daj|dajcie|zawolaj\w*|zawolac|wezwij\w*|wezwac|wolam|wolac|gdzie|halo|jest ktos|czy jest|jestescie|niech|odezwie|odpisze|odpiszcie|pomoze|pomozcie|przekaz\w*|pogadac|porozmawiac|rozmawiac|kontakt\w*|napisze|potrzebujemy)\b/;

/** true when the message asks for a person from the team. */
function asksForHuman(text) {
  const t = fold(text);
  if (!t) return false;
  // „Jesteś człowiekiem czy botem?” asks about the assistant, not for a person – the assistant answers that itself.
  const aboutAssistant = /\b(jestes|jestes ty|czy ty|to ty|ty jestes|to jest|rozmawiam z) (\w+ )?(bot\w*|czlowiek\w*|ai)\b/.test(t) && !/\b(chce|prosze|daj|zawolaj|potrzebuje|wolalbym|wolalabym)\b/.test(t);
  if (!aboutAssistant && STRONG.some((re) => re.test(t))) return true;
  if (!ROLE.test(t)) return false;
  if (ASK.test(t)) return true;
  const words = t.split(' ').filter((w) => /[a-z0-9]/.test(w));
  return words.length <= 3; // „admin”, „ADMIN!!”, „administracja pls”
}

module.exports = { asksForHuman, fold };
