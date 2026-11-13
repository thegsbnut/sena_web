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
  },
];
export const CLUB_IDS = CLUB_LIST.map(club => club.id);
export const DEFAULT_CLUB = CLUB_IDS[0];
export const isClub = id => CLUB_IDS.includes(id);
// Hidden sandbox club for dev-login test users (see dev-auth.js). It is NOT in
// CLUB_LIST / CLUB_IDS, so "all clubs" lists, cross-club mapping, cron jobs and
// LINE group replies never include it. The worker accepts ?club=test only while
// DEV_AUTH is on.
export const TEST_CLUB = 'test';
export const TEST_CLUB_INFO = {
  id: TEST_CLUB,
  label: 'TEST',
  heading: 'ทดสอบ',
  cupName: 'Test Cup',
  stateTable: 'club_state_test',
  cupTable: 'cup_history_test',
  defaultCupWeek: 2,
  hasBaseline: false,
};
// Unknown ids fall back to the default club, as the old `club === '88' ? … : …` did.
export const clubOf = id =>
  id === TEST_CLUB ? TEST_CLUB_INFO : (CLUB_LIST.find(club => club.id === id) ?? CLUB_LIST[0]);
// LINE member accounts are mapped across exactly two clubs; this is the other one.
export const counterpartClub = id => CLUB_IDS.find(other => other !== id);
