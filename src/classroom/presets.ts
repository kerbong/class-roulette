/**
 * 상황별 뽑기 모드.
 *
 * 교실에서 룰렛을 쓰는 상황은 사실 몇 가지로 정해져 있다. 매번 맵/속도/등수를
 * 손으로 맞추는 대신, 상황 이름만 고르면 그 세팅이 통째로 적용되게 한다.
 */

/** 맵 인덱스는 src/data/maps.ts의 stages 순서. 코스가 길수록 오래 걸린다 */
export const MapIndex = {
  /** Wheel of fortune - 보통 길이, 무난 */
  wheel: 0,
  /** BubblePop - 가장 짧다 */
  bubble: 1,
  /** Pot of greed - 짧은 편 */
  pot: 2,
  /** Yoru ni Kakeru - 가장 길다. 끝까지 마음을 졸이게 된다 */
  night: 3,
} as const;

/** 몇 명을 뽑을지 정하는 방식 */
export type CountMode =
  /** 프리셋에 박힌 고정 인원 */
  | 'fixed'
  /** 교사가 숫자를 입력 */
  | 'input'
  /** 참가자 전원 (순서/모둠용) */
  | 'all';

/** 결과 화면을 어떻게 보여줄지 */
export type ResultKind = 'winners' | 'order' | 'teams';

export interface Preset {
  id: string;
  emoji: string;
  title: string;
  /** 카드에 적히는 한 줄 설명 */
  desc: string;
  map: number;
  speed: number;
  useSkills: boolean;
  countMode: CountMode;
  /** 뽑을 인원. countMode가 all이면 대신 보조 숫자(모둠 수 등)의 초기값으로 쓰인다 */
  count: number;
  /** 숫자 입력 칸에 붙는 라벨. 없으면 입력 칸을 숨긴다 */
  inputLabel?: string;
  /** true면 꼴찌를 뽑는다. 당번/벌칙용 */
  fromLast: boolean;
  resultKind: ResultKind;
  /** 결과 화면 제목 */
  resultTitle: string;
}

export const presets: Preset[] = [
  {
    id: 'quick',
    emoji: '⚡',
    title: '빨리 한 명',
    desc: '짧은 코스로 10초 안에 끝. 발표자 지목용',
    map: MapIndex.bubble,
    speed: 3,
    useSkills: false,
    countMode: 'fixed',
    count: 1,
    fromLast: false,
    resultKind: 'winners',
    resultTitle: '당첨!',
  },
  {
    id: 'suspense',
    emoji: '🥁',
    title: '두근두근 한 명',
    desc: '가장 긴 코스. 상품 뽑기처럼 끝까지 조마조마',
    map: MapIndex.night,
    speed: 1,
    useSkills: true,
    countMode: 'fixed',
    count: 1,
    fromLast: false,
    resultTitle: '오늘의 행운은',
    resultKind: 'winners',
  },
  {
    id: 'pair',
    emoji: '👯',
    title: '짝 뽑기 (2명)',
    desc: '둘씩 짝지을 때. 1·2등 두 명을 뽑는다',
    map: MapIndex.wheel,
    speed: 2,
    useSkills: false,
    countMode: 'fixed',
    count: 2,
    fromLast: false,
    resultKind: 'winners',
    resultTitle: '오늘의 짝',
  },
  {
    id: 'many',
    emoji: '👥',
    title: '여러 명 뽑기',
    desc: '모둠 대표, 도우미 등 원하는 인원수만큼',
    map: MapIndex.wheel,
    speed: 2,
    useSkills: false,
    countMode: 'input',
    count: 4,
    inputLabel: '뽑을 인원',
    fromLast: false,
    resultKind: 'winners',
    resultTitle: '뽑힌 사람',
  },
  {
    id: 'last',
    emoji: '🧹',
    title: '마지막 한 명',
    desc: '꼴찌가 당첨. 당번·심부름 정할 때',
    map: MapIndex.pot,
    speed: 2.5,
    useSkills: false,
    countMode: 'fixed',
    count: 1,
    fromLast: true,
    resultKind: 'winners',
    resultTitle: '오늘의 당번',
  },
  {
    id: 'order',
    emoji: '📋',
    title: '발표 순서 정하기',
    desc: '전원의 순서를 한 번에. 골인 순서가 곧 발표 순서',
    map: MapIndex.bubble,
    speed: 4,
    useSkills: false,
    countMode: 'all',
    count: 0,
    fromLast: false,
    resultKind: 'order',
    resultTitle: '발표 순서',
  },
  {
    id: 'teams',
    emoji: '🧩',
    title: '모둠 나누기',
    desc: '전원을 뽑아 모둠 수만큼 고르게 나눈다',
    map: MapIndex.bubble,
    speed: 4,
    useSkills: false,
    // 전원이 골인해야 순서가 나오고, 그 순서를 모둠으로 나눈다.
    // 아래 숫자 입력은 '뽑을 인원'이 아니라 '모둠 수'다
    countMode: 'all',
    count: 4,
    inputLabel: '모둠 수',
    fromLast: false,
    resultKind: 'teams',
    resultTitle: '모둠 편성',
  },
];

export function findPreset(id: string): Preset {
  return presets.find((p) => p.id === id) ?? presets[0];
}

/**
 * 골인 순서(전원)를 모둠 수만큼 뱀 모양(1,2,3,3,2,1...)으로 나눈다.
 * 앞 등수가 한 모둠에 몰리지 않게 하려는 것.
 */
export function splitIntoTeams(order: string[], teamCount: number): string[][] {
  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  order.forEach((name, i) => {
    const row = Math.floor(i / teamCount);
    const col = i % teamCount;
    const index = row % 2 === 0 ? col : teamCount - 1 - col;
    teams[index].push(name);
  });
  return teams;
}

/**
 * 남녀가 한 모둠에 몰리지 않게 나눈다.
 *
 * 골인 순서를 성별끼리 모아 다시 줄 세운 뒤 같은 뱀 모양으로 돌린다.
 * 같은 성별이 연달아 있으니 서로 다른 모둠으로 흩어지고, 뱀 모양이라
 * 나머지 인원도 한쪽에 쌓이지 않는다. 모둠별 총원은 그대로 고르다.
 */
export function splitIntoTeamsMixed(order: { name: string; gender: 'm' | 'f' | 'x' }[], teamCount: number): string[][] {
  const byGender = [
    ...order.filter((member) => member.gender === 'm'),
    ...order.filter((member) => member.gender === 'f'),
    ...order.filter((member) => member.gender === 'x'),
  ];
  return splitIntoTeams(
    byGender.map((member) => member.name),
    teamCount
  );
}
