// Which Badbot cards carry the Cup sponsor strip (line-sponsor-card.js). A card
// builder marks its bubble; the reply adds the strip under marked bubbles only.
// A Symbol key never reaches JSON, so LINE never sees the mark.
export const SPONSOR_MARK = Symbol('sponsor');
// `cupDate` pins the strip to that Cup day (a Cup result card); without it the
// card shows whichever sponsors are in their display window today.
export function markSponsor(bubble, club, cupDate = null) {
  bubble[SPONSOR_MARK] = { club, cupDate };
  return bubble;
}
