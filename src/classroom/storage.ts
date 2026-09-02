/**
 * 반 명단과 "오늘 상태"를 브라우저에 저장한다.
 *
 * 서버가 없다. 교실 PC 한 대에서 쓰는 물건이라 localStorage로 충분하고,
 * 학생 이름이 밖으로 나가지 않는다는 점도 이 방식의 장점이다.
 */

const ROSTER_KEY = 'cr_rosters';
const ACTIVE_KEY = 'cr_active_roster';
const DAY_KEY_PREFIX = 'cr_day_';
const LOG_KEY = 'cr_log';

/**
 * 명단을 무엇으로 부를지.
 *
 * 기본은 'number'. 실명을 아예 저장하지 않으니 공용 교실 PC에 남는 것도 없고,
 * 화면을 다른 반이 봐도 개인정보가 노출되지 않는다.
 * 이름이 꼭 필요한 경우에만 'name'을 쓴다.
 */
export type RosterMode = 'number' | 'name';

/** 'x'는 성별 미지정. 성별로 뽑을 일이 없는 반은 전부 'x'로 둔다 */
export type Gender = 'm' | 'f' | 'x';

/** 뽑기 화면의 성별 조건. 미지정('x')만 골라 뽑을 일은 없어서 빠져 있다 */
export type GenderFilter = 'all' | 'm' | 'f';

export interface Member {
  name: string;
  gender: Gender;
}

export interface Roster {
  id: string;
  name: string;
  mode: RosterMode;
  members: Member[];
}

/** 하루짜리 상태. 날짜가 바뀌면 통째로 버린다 */
export interface DayState {
  date: string;
  /** 오늘 빠진 학생 */
  absent: string[];
  /**
   * 이어하기로 누적된, 이미 뽑힌 학생.
   * 결과 화면에서 '이어하기'를 누르면 유지되고 '새로 뽑기'를 누르면 비워진다
   */
  drawn: string[];
}

export interface LogEntry {
  time: number;
  rosterName: string;
  presetTitle: string;
  /** 그 판을 뽑을 때 걸려 있던 성별 조건 */
  genderFilter: GenderFilter;
  winners: string[];
  /** 이 판까지 이어하기로 누적된 인원 */
  streak: number;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('저장 실패', e);
  }
}

/** 1번 ~ N번. 성별은 미지정 상태로 만든다 */
export function makeNumberMembers(count: number): Member[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({ name: `${i + 1}번`, gender: 'x' as Gender }));
}

/**
 * 앞에서부터 maleCount명을 남학생, 나머지를 여학생으로 정한다.
 * 번호가 남자 먼저 붙는 학급이 많아서, 그 경우 한 번에 끝난다.
 */
export function assignByOrder(members: Member[], maleCount: number): Member[] {
  return members.map((member, i) => ({ ...member, gender: i < maleCount ? 'm' : 'f' }));
}

export function genderLabel(gender: Gender): string {
  return gender === 'm' ? '남' : gender === 'f' ? '여' : '-';
}

/** 성별이 하나라도 지정돼 있는지. 전부 미지정이면 성별 필터를 띄우지 않는다 */
export function hasGenderInfo(members: Member[]): boolean {
  return members.some((member) => member.gender !== 'x');
}

/** 저장돼 있던 명단을 지금 코드가 기대하는 모양으로 맞춘다 */
function normalizeRoster(raw: any): Roster {
  const members: Member[] = (raw.members ?? []).map((member: any) =>
    // 성별이 없던 시절에는 이름 문자열만 저장했다
    typeof member === 'string' ? { name: member, gender: 'x' as Gender } : { gender: 'x' as Gender, ...member }
  );
  return {
    id: raw.id,
    name: raw.name,
    // mode가 없던 시절에 저장된 명단은 이름으로 만든 것이다
    mode: raw.mode ?? 'name',
    members,
  };
}

export function loadRosters(): Roster[] {
  const rosters = read<any[]>(ROSTER_KEY, []);
  if (rosters.length > 0) return rosters.map(normalizeRoster);

  // 첫 실행이면 바로 굴려볼 수 있게 번호 명단을 하나 만들어 둔다
  const seed: Roster[] = [{ id: 'sample', name: '우리 반', mode: 'number', members: makeNumberMembers(24) }];
  write(ROSTER_KEY, seed);
  return seed;
}

export function saveRosters(rosters: Roster[]) {
  write(ROSTER_KEY, rosters);
}

export function getActiveRosterId(): string {
  return read<string>(ACTIVE_KEY, '');
}

export function setActiveRosterId(id: string) {
  write(ACTIVE_KEY, id);
}

export function newRosterId(): string {
  return `r${Date.now().toString(36)}`;
}

/** 이름 입력창의 자유 형식을 이름 배열로 바꾼다 */
export function parseMembers(text: string): string[] {
  const names = text
    .split(/[\n,\t]/g)
    .map((line) =>
      line
        .trim()
        // "1. 김철수", "12 김철수" 같은 번호를 떼어낸다. 번호는 이름이 아니다
        .replace(/^\d+\s*[.)-]?\s*/, '')
        .trim()
        // 엔진이 '/'를 가중치, '*'를 인원수로 읽는다. 이름에 섞이면 오작동한다
        .replace(/[/*]/g, ' ')
        .trim()
    )
    .filter((name) => name.length > 0);

  // 같은 이름이 두 명 있으면 결석·뽑힘 처리가 한 사람으로 뭉개진다. 뒤에 번호를 붙여 갈라놓는다
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}${count}`;
  });
}

export function loadDayState(rosterId: string): DayState {
  const fresh: DayState = { date: today(), absent: [], drawn: [] };
  if (!rosterId) return fresh;
  const state = read<DayState>(DAY_KEY_PREFIX + rosterId, fresh);
  // 날짜가 지났으면 결석·뽑힘 기록은 의미가 없다
  return state.date === today() ? { ...fresh, ...state } : fresh;
}

export function saveDayState(rosterId: string, state: DayState) {
  if (!rosterId) return;
  write(DAY_KEY_PREFIX + rosterId, { ...state, date: today() });
}

export function loadLog(): LogEntry[] {
  return read<LogEntry[]>(LOG_KEY, []).filter((entry) => entry.time > Date.now() - 1000 * 60 * 60 * 24 * 14);
}

export function appendLog(entry: LogEntry) {
  const log = loadLog();
  log.unshift(entry);
  write(LOG_KEY, log.slice(0, 50));
}

export function clearLog() {
  write(LOG_KEY, []);
}
