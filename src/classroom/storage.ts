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

export interface Roster {
  id: string;
  name: string;
  mode: RosterMode;
  members: string[];
}

/** 1번 ~ N번 */
export function makeNumberMembers(count: number): string[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => `${i + 1}번`);
}

/** 하루짜리 상태. 날짜가 바뀌면 통째로 버린다 */
export interface DayState {
  date: string;
  /** 오늘 빠진 학생 */
  absent: string[];
  /** 오늘 이미 뽑힌 학생 */
  drawn: string[];
}

export interface LogEntry {
  time: number;
  rosterName: string;
  presetTitle: string;
  winners: string[];
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

export function loadRosters(): Roster[] {
  const rosters = read<Roster[]>(ROSTER_KEY, []);
  if (rosters.length > 0) {
    // mode가 없던 시절에 저장된 명단은 이름으로 만든 것이다
    return rosters.map((roster) => ({ ...roster, mode: roster.mode ?? 'name' }));
  }

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

/** 이름 입력창의 자유 형식을 명단 배열로 바꾼다 */
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
  return state.date === today() ? state : fresh;
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
