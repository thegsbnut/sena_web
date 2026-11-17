// The single place that describes the clubs (ก๊วน). Everything server-side that
// used to hard-code 'sena' / '88' (table names, labels, lists) reads from here.
// Order matters: the first club is the default and the order used in "all" lists.
export const CLUB_LIST = [
  {
    id: 'sena',
    label: 'Sena',
    heading: 'เสนา',
    cupName: 'Sena Cup',
    stateTable: 'club_state',
    cupTable: 'cup_history',
    defaultCupWeek: 2,
    hasBaseline: true,
    // Default Google Maps link of the venue; an organizer can override it in the app.
    venueMapUrl: 'https://maps.app.goo.gl/Krmzhw3QxseJ4thW6',
    // Spelling variants (lower-case) of a player name that count as one person in Cup stats.
    nameAliases: { nott: 'Not', not: 'Not', beau: 'Beau', bo: 'Beau' },
  },
  {
    id: '88',
    label: '88',
    heading: '88',
    cupName: '88 Cup',
    stateTable: 'club_state_88',
    cupTable: 'cup_history_88',
    defaultCupWeek: 4,
    hasBaseline: false,
    venueMapUrl: 'https://maps.app.goo.gl/9AwoUgdYb4gjNw2w8',
    nameAliases: {},
  },
];
export const CLUB_IDS = CLUB_LIST.map(club => club.id);
export const DEFAULT_CLUB = CLUB_IDS[0];
export const isClub = id => CLUB_IDS.includes(id);
// Unknown ids fall back to the default club, as the old `club === '88' ? … : …` did.
export const clubOf = id => CLUB_LIST.find(club => club.id === id) ?? CLUB_LIST[0];
// LINE member accounts are mapped across exactly two clubs; this is the other one.
export const counterpartClub = id => CLUB_IDS.find(other => other !== id);
