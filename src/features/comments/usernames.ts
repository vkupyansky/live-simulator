export interface PersonaIdentity {
  username: string;
  displayName: string;
}

type UsernameFactory = (index: number) => string;

interface FamilyPlan {
  count: number;
  create: UsernameFactory;
}

const RU_NAME_STEMS = [
  'sasha',
  'anya',
  'dasha',
  'katya',
  'lera',
  'vika',
  'nastya',
  'polina',
  'sonya',
  'alina',
  'arina',
  'mila',
  'kira',
  'nika',
  'yana',
  'eva',
  'lina',
  'olya',
  'lena',
  'irishka',
  'masha',
  'ksyu',
  'tanya',
  'karina',
  'marina',
  'kristi',
  'sofia',
  'amina',
  'alisa',
  'alla',
  'vera',
  'vlada',
  'varvara',
  'zoya',
  'mayya',
  'ulya',
  'lyuba',
  'nadin',
  'renata',
  'liza',
  'rita',
  'diana',
  'milana',
  'elina',
  'valya',
  'max',
  'tema',
  'vlad',
  'roma',
  'kirill',
  'denis',
  'egor',
  'nikita',
  'timur',
  'ilya',
  'pasha',
  'dima',
  'kostya',
  'lyosha',
  'misha',
  'sergey',
  'andrey',
  'artem',
  'gleb',
  'lev',
  'mark',
  'daniil',
  'danya',
  'vitya',
  'yan',
  'oleg',
  'ruslan',
  'renat',
  'vadim',
  'anton',
  'semen',
  'yura',
  'igor',
  'matvey',
  'filipp',
] as const;

const EN_NAME_STEMS = [
  'mia',
  'emma',
  'ava',
  'zoe',
  'lily',
  'chloe',
  'ellie',
  'lucy',
  'olivia',
  'sophie',
  'noah',
  'liam',
  'lucas',
  'leo',
  'ethan',
  'jay',
  'alex',
  'sam',
  'nate',
  'ryan',
  'ivy',
  'ruby',
  'grace',
  'ella',
  'hannah',
  'maya',
  'aiden',
  'logan',
  'mason',
  'finn',
  'cole',
  'theo',
  'evan',
  'dean',
  'jude',
  'blair',
  'skye',
  'drew',
  'reese',
  'quinn',
] as const;

const SOCIAL_PREFIXES = [
  'callme',
  'hey',
  'hi',
  'im',
  'its',
  'just',
  'maybe',
  'not',
  'ok',
  'only',
  'real',
  'that',
  'the',
  'thisis',
] as const;

const PERSONAL_WORDS = [
  'afterdark',
  'anywhere',
  'backstage',
  'bluehour',
  'bychance',
  'daydream',
  'elsewhere',
  'evergreen',
  'firsttake',
  'fromhome',
  'goodnight',
  'halflight',
  'hereagain',
  'inmotion',
  'insideout',
  'latermaybe',
  'littlemore',
  'lowkey',
  'midweek',
  'moonrise',
  'newchapter',
  'nextdoor',
  'nightshift',
  'noagenda',
  'noted',
  'offcamera',
  'onrepeat',
  'outthere',
  'overcast',
  'ownpace',
  'rightnow',
  'sameplace',
  'secondtake',
  'sidequest',
  'slowdays',
  'somehow',
  'sometime',
  'stillhere',
  'sundayish',
  'sunsetclub',
  'tinyroom',
  'todayonly',
  'undertone',
  'weekendish',
  'withoutnoise',
  'wrongturn',
  'yesterday',
] as const;

const TRANSLIT_LEFT = [
  'bez',
  'budto',
  'davay',
  'gde',
  'kakaya',
  'koroche',
  'ladno',
  'medlenno',
  'mozhno',
  'navernoe',
  'ne',
  'nu',
  'pochti',
  'poka',
  'prosto',
  'ryadom',
  'seychas',
  'sluchayno',
  'snova',
  'spokoyno',
  'takaya',
  'tam',
  'tihiy',
  'tochno',
  'tut',
  'vdrug',
  'vot',
  'zachem',
  'znachit',
  'zvuchit',
] as const;

const TRANSLIT_RIGHT = [
  'atmosfera',
  'bezsonnica',
  'chay',
  'doma',
  'dusha',
  'efir',
  'fonarik',
  'golubika',
  'istorija',
  'kadr',
  'kamera',
  'kot',
  'kuhnya',
  'lampochka',
  'leto',
  'luna',
  'melodiya',
  'moment',
  'more',
  'mysli',
  'noch',
  'oblako',
  'okno',
  'pauza',
  'pesnya',
  'pogoda',
  'razgovor',
  'svet',
  'tishina',
  'volna',
  'vopros',
  'zakat',
  'zvuk',
] as const;

const AESTHETIC_LEFT = [
  'amber',
  'blue',
  'blurred',
  'cloudy',
  'cosmic',
  'cozy',
  'crimson',
  'dreamy',
  'dusty',
  'electric',
  'faded',
  'frosted',
  'glossy',
  'golden',
  'hazy',
  'hidden',
  'hollow',
  'indigo',
  'lavender',
  'little',
  'lofi',
  'lonely',
  'lunar',
  'midnight',
  'mint',
  'neon',
  'peachy',
  'quiet',
  'retro',
  'silver',
  'sleepy',
  'soft',
  'solar',
  'tiny',
  'velvet',
  'violet',
  'warm',
  'wild',
] as const;

const AESTHETIC_RIGHT = [
  'archive',
  'bloom',
  'breeze',
  'cafe',
  'cherry',
  'cloud',
  'daze',
  'echo',
  'fairy',
  'film',
  'frame',
  'garden',
  'glow',
  'halo',
  'horizon',
  'lace',
  'lilac',
  'mango',
  'meadow',
  'mirror',
  'moon',
  'moth',
  'noise',
  'orbit',
  'pearl',
  'petal',
  'polaroid',
  'rain',
  'ribbon',
  'room',
  'signal',
  'skyline',
  'spark',
  'star',
  'studio',
  'sunrise',
  'tape',
  'velour',
  'wave',
] as const;

const GAMING_LEFT = [
  'afk',
  'boosted',
  'buffering',
  'clutch',
  'critical',
  'dodge',
  'finalboss',
  'fragged',
  'glitched',
  'lowhp',
  'mainless',
  'nerfed',
  'nolag',
  'noobish',
  'offline',
  'overclock',
  'queued',
  'respawning',
  'speedrun',
  'tilted',
  'unranked',
  'warmedup',
] as const;

const GAMING_RIGHT = [
  'arcade',
  'bandit',
  'byte',
  'checkpoint',
  'combo',
  'controller',
  'cooldown',
  'crosshair',
  'drop',
  'dungeon',
  'frag',
  'goblin',
  'hitbox',
  'inventory',
  'lobby',
  'loot',
  'main',
  'mana',
  'npc',
  'party',
  'ping',
  'quest',
  'respawn',
  'scoreboard',
  'spawn',
  'sprite',
  'stamina',
  'stealth',
  'trigger',
  'xp',
] as const;

const IRONIC_LEFT = [
  'almosta',
  'apparently',
  'justanother',
  'kindof',
  'literally',
  'maybeits',
  'nobodyasked',
  'nopejust',
  'notreally',
  'okaybut',
  'probably',
  'somewhat',
  'stillnot',
  'technically',
  'totallynot',
  'whyis',
] as const;

const IRONIC_RIGHT = [
  'adulting',
  'alarm',
  'backdrop',
  'blanket',
  'braincell',
  'breakfast',
  'calendar',
  'chair',
  'charger',
  'coffee',
  'deadline',
  'doorway',
  'excuse',
  'fridge',
  'headache',
  'plant',
  'laundry',
  'leftover',
  'microwave',
  'monday',
  'nap',
  'notif',
  'overshare',
  'password',
  'pajamas',
  'plot',
  'receipt',
  'remote',
  'screencap',
  'snack',
  'socks',
  'spoon',
  'tab',
  'teacup',
  'toaster',
  'weekend',
  'wishlist',
] as const;

const INITIALS = [
  'ak',
  'al',
  'am',
  'an',
  'ar',
  'av',
  'dk',
  'dm',
  'ds',
  'ek',
  'em',
  'ev',
  'ik',
  'il',
  'ir',
  'ka',
  'kd',
  'ki',
  'km',
  'ks',
  'lv',
  'ma',
  'md',
  'mi',
  'mk',
  'na',
  'nd',
  'ni',
  'nk',
  'pa',
  'pk',
  'rm',
  'sa',
  'sd',
  'sk',
  'sm',
  'ta',
  'tk',
  'va',
  'vk',
  'ya',
  'yl',
  'za',
  'zk',
] as const;

const INITIAL_WORDS = [
  'ambient',
  'bside',
  'camera',
  'casual',
  'channel',
  'chatroom',
  'corner',
  'daily',
  'draft',
  'extra',
  'feed',
  'focus',
  'found',
  'home',
  'journal',
  'late',
  'live',
  'memo',
  'minute',
  'mood',
  'notes',
  'open',
  'page',
  'pause',
  'private',
  'public',
  'radio',
  'random',
  'raw',
  'replay',
  'scene',
  'screen',
  'side',
  'sound',
  'stream',
  'take',
  'talks',
  'thread',
  'today',
  'unedited',
  'view',
  'voice',
] as const;

const EN_CASUAL_LEFT = [
  'actually',
  'barely',
  'currently',
  'definitely',
  'honestly',
  'lowkey',
  'mostly',
  'perhaps',
  'randomly',
  'somehow',
  'usually',
  'whatever',
] as const;

const EN_CASUAL_RIGHT = [
  'awake',
  'confused',
  'curious',
  'editing',
  'listening',
  'lurking',
  'online',
  'scrolling',
  'thinking',
  'watching',
  'wondering',
] as const;

const NATURAL_NUMBER_TAILS = [
  '02',
  '03',
  '05',
  '06',
  '07',
  '08',
  '09',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
  '41',
  '42',
  '43',
  '45',
  '46',
  '47',
  '48',
  '49',
  '50',
  '51',
  '52',
  '53',
  '54',
  '56',
  '57',
  '58',
] as const;

function pairUsername(
  index: number,
  left: readonly string[],
  right: readonly string[],
  variantOffset: number,
): string {
  const leftIndex = index % left.length;
  const cycle = Math.floor(index / left.length);
  const first = left[leftIndex];
  const second = right[(leftIndex * 17 + cycle) % right.length];
  if (!first || !second) throw new Error('Локальный набор username неполон.');
  switch ((leftIndex + cycle + variantOffset) % 10) {
    case 0:
    case 1:
    case 3:
      return `${first}${second}`;
    case 2:
    case 4:
      return `${second}${first}`;
    case 5:
      return `${first}.${second}`;
    case 6:
      return `${second}.${first}`;
    case 7:
      return `${first}_${second}`;
    case 8:
      return `${second}_${first}`;
    default:
      return `${first}${second}`;
  }
}

function socialFactory(names: readonly string[], offset: number): UsernameFactory {
  return (index) => {
    const nameIndex = index % names.length;
    const cycle = Math.floor(index / names.length);
    const name = names[nameIndex];
    const prefix = SOCIAL_PREFIXES[(nameIndex * 5 + cycle + offset) % SOCIAL_PREFIXES.length];
    if (!name || !prefix) throw new Error('Локальный набор username неполон.');
    switch ((nameIndex + cycle + offset) % 8) {
      case 0:
      case 2:
        return `${prefix}${name}`;
      case 1:
      case 7:
        return `${name}${prefix}`;
      case 3:
        return `${prefix}.${name}`;
      case 4:
        return `${name}.${prefix}`;
      case 5:
        return `${prefix}_${name}`;
      default:
        return `${name}_${prefix}`;
    }
  };
}

function personalFactory(names: readonly string[], offset: number): UsernameFactory {
  return (index) => pairUsername(index, names, PERSONAL_WORDS, offset);
}

function pairFactory(
  left: readonly string[],
  right: readonly string[],
  offset: number,
  startIndex = 0,
): UsernameFactory {
  return (index) => pairUsername(index + startIndex, left, right, offset);
}

const RU_FAMILIES: readonly FamilyPlan[] = [
  { count: 500, create: socialFactory(RU_NAME_STEMS, 0) },
  { count: 600, create: personalFactory(RU_NAME_STEMS, 1) },
  { count: 900, create: pairFactory(TRANSLIT_LEFT, TRANSLIT_RIGHT, 2) },
  { count: 750, create: pairFactory(AESTHETIC_LEFT, AESTHETIC_RIGHT, 3) },
  { count: 500, create: pairFactory(GAMING_LEFT, GAMING_RIGHT, 4) },
  { count: 500, create: pairFactory(IRONIC_LEFT, IRONIC_RIGHT, 5) },
  { count: 500, create: pairFactory(INITIALS, INITIAL_WORDS, 6) },
] as const;

const EN_FAMILIES: readonly FamilyPlan[] = [
  { count: 90, create: socialFactory(EN_NAME_STEMS, 3) },
  { count: 130, create: personalFactory(EN_NAME_STEMS, 4) },
  { count: 90, create: pairFactory(EN_CASUAL_LEFT, EN_CASUAL_RIGHT, 5) },
  { count: 130, create: pairFactory(AESTHETIC_LEFT, AESTHETIC_RIGHT, 6, 750) },
  { count: 110, create: pairFactory(GAMING_LEFT, GAMING_RIGHT, 7, 500) },
  { count: 90, create: pairFactory(IRONIC_LEFT, IRONIC_RIGHT, 8, 500) },
  { count: 110, create: pairFactory(INITIALS, INITIAL_WORDS, 9, 500) },
] as const;

function expandFamilies(families: readonly FamilyPlan[]): string[] {
  return families.flatMap(({ count, create }) =>
    Array.from({ length: count }, (_, index) => create(index)),
  );
}

function shouldHaveNumber(globalIndex: number): boolean {
  return (globalIndex * 37 + 11) % 100 < 2;
}

function prettifyUsername(username: string): string {
  const first = username[0];
  return first ? `${first.toUpperCase()}${username.slice(1)}` : username;
}

function buildCatalog(): { ru: PersonaIdentity[]; en: PersonaIdentity[] } {
  const raw = [
    ...expandFamilies(RU_FAMILIES).map((username) => ({ language: 'ru' as const, username })),
    ...expandFamilies(EN_FAMILIES).map((username) => ({ language: 'en' as const, username })),
  ];
  if (new Set(raw.map(({ username }) => username)).size !== raw.length)
    throw new Error('Исходный каталог username содержит повторения.');
  let numbered = 0;
  const identities = raw.map(({ language, username }, globalIndex) => {
    const withNumber = shouldHaveNumber(globalIndex);
    const tail = withNumber
      ? NATURAL_NUMBER_TAILS[(numbered * 17) % NATURAL_NUMBER_TAILS.length]
      : undefined;
    if (withNumber) numbered += 1;
    const decorated = tail ? `${username}${globalIndex % 2 === 0 ? '' : '.'}${tail}` : username;
    return { language, username: decorated, displayName: prettifyUsername(username) };
  });

  if (identities.length !== 5_000)
    throw new Error('Каталог username должен содержать 5000 записей.');
  if (new Set(identities.map(({ username }) => username)).size !== identities.length)
    throw new Error('Каталог username содержит повторения.');
  if (new Set(identities.map(({ displayName }) => displayName)).size !== identities.length)
    throw new Error('Каталог отображаемых имён содержит повторения.');
  if (
    identities.some(
      ({ username }) =>
        !/^[a-z0-9._]{2,24}$/u.test(username) || username.endsWith('.') || username.includes('..'),
    )
  )
    throw new Error('Каталог содержит несовместимый username.');

  return {
    ru: identities
      .filter(({ language }) => language === 'ru')
      .map(({ username, displayName }) => ({ username, displayName })),
    en: identities
      .filter(({ language }) => language === 'en')
      .map(({ username, displayName }) => ({ username, displayName })),
  };
}

export const PERSONA_IDENTITIES_BY_LANGUAGE = buildCatalog();

export const PERSONA_USERNAME_POOL = [
  ...PERSONA_IDENTITIES_BY_LANGUAGE.ru.map(({ username }) => username),
  ...PERSONA_IDENTITIES_BY_LANGUAGE.en.map(({ username }) => username),
];
