import options from '../options';
import type { Roulette } from '../roulette';
import { type Preset, presets, splitIntoTeams, splitIntoTeamsMixed } from './presets';
import * as store from './storage';

function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`엘리먼트를 찾을 수 없습니다: ${selector}`);
  return el;
}

function toast(message: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

/** 결과가 나온 뒤 이 시간만큼은 구슬 화면(폭죽)을 보여주고 나서 결과창을 띄운다 */
const RESULT_DELAY_MS = 1800;

type GenderFilter = store.GenderFilter;

const FILTER_LABEL: Record<GenderFilter, string> = { all: '전체', m: '남자', f: '여자' };

export class ClassroomApp {
  private rosters: store.Roster[] = [];
  private rosterId = '';
  private day: store.DayState = { date: store.today(), absent: [], drawn: [] };
  private preset: Preset = presets[0];
  /** countMode가 'input'인 프리셋에서 교사가 넣은 숫자. 프리셋별로 기억한다 */
  private inputCounts: Record<string, number> = {};
  private genderFilter: GenderFilter = 'all';
  /** 모둠 나누기에서 남녀를 흩어놓을지 */
  private mixGender = true;
  private speed = 2;
  private currentMap = -1;
  /** 명단 편집 창에서 작업 중인 명단. 저장을 눌러야 실제 명단에 반영된다 */
  private editMembers: store.Member[] = [];

  constructor(private roulette: Roulette) {}

  start() {
    this.rosters = store.loadRosters();
    const savedId = store.getActiveRosterId();
    this.rosterId = this.rosters.some((r) => r.id === savedId) ? savedId : this.rosters[0].id;
    this.day = store.loadDayState(this.rosterId);
    presets.forEach((p) => {
      this.inputCounts[p.id] = p.count;
    });

    this.buildModeCards();
    this.bindEvents();
    this.renderRosterSelect();
    this.applyTheme();
    this.selectPreset(presets[0]);
    this.renderRecent();
  }

  // ---------------------------------------------------------------- 참가자

  private get roster(): store.Roster {
    return this.rosters.find((r) => r.id === this.rosterId) ?? this.rosters[0];
  }

  /** 결석자와 이어하기로 이미 뽑힌 사람을 뺀, 아직 뽑힐 수 있는 사람 */
  private available(): store.Member[] {
    return this.roster.members.filter(
      (member) => !this.day.absent.includes(member.name) && !this.day.drawn.includes(member.name)
    );
  }

  /** available에서 성별 조건까지 맞는 참가자 이름 */
  private pool(): string[] {
    return this.available()
      .filter((member) => this.genderFilter === 'all' || member.gender === this.genderFilter)
      .map((member) => member.name);
  }

  /** 이번 프리셋에서 뽑을 인원 */
  private drawCount(poolSize: number): number {
    if (this.preset.countMode === 'all') return poolSize;
    const wanted = this.preset.countMode === 'input' ? this.inputCounts[this.preset.id] : this.preset.count;
    return Math.max(1, Math.min(wanted, poolSize));
  }

  // ---------------------------------------------------------------- 렌더링

  private renderRosterSelect() {
    const select = $<HTMLSelectElement>('#rosterSelect');
    select.innerHTML = '';
    this.rosters.forEach((roster) => {
      const option = document.createElement('option');
      option.value = roster.id;
      option.textContent = `${roster.name} (${roster.members.length}명)`;
      select.append(option);
    });
    const addOption = document.createElement('option');
    addOption.value = '__new__';
    addOption.textContent = '+ 새 반 만들기';
    select.append(addOption);
    select.value = this.rosterId;
  }

  private buildModeCards() {
    const grid = $('#modeGrid');
    grid.innerHTML = '';
    presets.forEach((preset) => {
      const card = document.createElement('button');
      card.className = 'cr-mode';
      card.dataset.preset = preset.id;
      card.innerHTML = `
        <span class="cr-mode-emoji">${preset.emoji}</span>
        <span class="cr-mode-title">${preset.title}</span>
        <span class="cr-mode-desc">${preset.desc}</span>`;
      card.addEventListener('click', () => this.selectPreset(preset));
      grid.append(card);
    });
  }

  private renderModeExtra() {
    const box = $('#modeExtra');
    box.innerHTML = '';
    if (!this.preset.inputLabel) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');

    const label = document.createElement('span');
    label.textContent = this.preset.inputLabel;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '40';
    input.value = String(this.inputCounts[this.preset.id]);
    input.addEventListener('input', () => {
      this.inputCounts[this.preset.id] = Math.max(1, Number.parseInt(input.value, 10) || 1);
      this.renderPool();
    });

    box.append(label, input);

    // 모둠 나누기는 성별을 알면 남녀를 흩어놓을 수 있다. 성별이 없으면 물어볼 것도 없다
    if (this.preset.resultKind === 'teams' && store.hasGenderInfo(this.roster.members)) {
      const toggle = document.createElement('label');
      toggle.className = 'cr-check';
      toggle.innerHTML = `<input type="checkbox" ${this.mixGender ? 'checked' : ''}><span>남녀 고르게 섞기</span>`;
      toggle.querySelector('input')!.addEventListener('change', (e) => {
        this.mixGender = (e.target as HTMLInputElement).checked;
      });
      box.append(toggle);
    }
  }

  /** 성별 탭. 성별이 하나도 지정돼 있지 않으면 탭 대신 안내를 띄운다 */
  private renderGenderFilter() {
    const hasGender = store.hasGenderInfo(this.roster.members);
    $('#genderFilter').classList.toggle('hidden', !hasGender);
    $('#genderTip').classList.toggle('hidden', hasGender);
    if (!hasGender) {
      this.genderFilter = 'all';
      return;
    }

    const available = this.available();
    const counts: Record<GenderFilter, number> = {
      all: available.length,
      m: available.filter((member) => member.gender === 'm').length,
      f: available.filter((member) => member.gender === 'f').length,
    };

    document.querySelectorAll<HTMLElement>('#genderFilter button').forEach((btn) => {
      const key = btn.dataset.g as GenderFilter;
      btn.classList.toggle('active', key === this.genderFilter);
      const badge = btn.querySelector('em');
      if (badge) badge.textContent = String(counts[key]);
    });
  }

  /** 이어하기로 몇 명이 빠져 있는지를 항상 보이게 한다 */
  private renderStreak() {
    const drawn = this.day.drawn.length;
    $('#streakText').innerHTML =
      drawn === 0
        ? '<b class="fresh">새 뽑기</b> · 전원 참가'
        : `<b class="on">이어하기 중</b> · 이미 뽑힌 <b>${drawn}명</b> 제외`;
    $('#streakBox').classList.toggle('active', drawn > 0);
    $<HTMLButtonElement>('#btnResetDay').disabled = drawn === 0 && this.day.absent.length === 0;
  }

  private renderPool() {
    const pool = this.pool();
    $('#poolCount').textContent = String(pool.length);
    this.renderGenderFilter();
    this.renderStreak();

    // 성별 탭을 켜 두면 그 성별만 보여준다. 다른 성별까지 늘어놓으면 무엇이 대상인지 흐려진다
    const shown = this.roster.members.filter(
      (member) => this.genderFilter === 'all' || member.gender === this.genderFilter
    );

    const chips = $('#poolChips');
    chips.innerHTML = '';
    shown.forEach((member) => {
      const chip = document.createElement('button');
      chip.className = `cr-chip g-${member.gender}`;
      chip.textContent = member.name;
      if (this.day.absent.includes(member.name)) chip.classList.add('absent');
      else if (this.day.drawn.includes(member.name)) chip.classList.add('drawn');
      chip.addEventListener('click', () => this.toggleAbsent(member.name));
      chips.append(chip);
    });

    const startBtn = $<HTMLButtonElement>('#btnStart');
    const enough = pool.length >= 2;
    startBtn.disabled = !enough;
    if (enough) {
      startBtn.textContent = `시작!  ${this.startLabel(pool.length)}`;
    } else if (this.day.drawn.length > 0) {
      startBtn.textContent = '남은 사람이 부족 — 기록을 초기화하세요';
    } else {
      startBtn.textContent = '참가자가 부족해요';
    }
  }

  /** 시작 버튼에 "무슨 일이 일어날지"를 적어둔다 */
  private startLabel(poolSize: number): string {
    const who = this.genderFilter === 'all' ? '' : `${FILTER_LABEL[this.genderFilter]} 중 `;
    if (this.preset.resultKind === 'order') return `${who}순서 정하기`;
    if (this.preset.resultKind === 'teams') return `${who}${this.inputCounts[this.preset.id]}모둠으로 나누기`;
    const count = this.drawCount(poolSize);
    return this.preset.fromLast ? `${who}꼴찌 ${count}명 뽑기` : `${who}${count}명 뽑기`;
  }

  private renderRecent() {
    const list = $('#recentList');
    const log = store.loadLog().slice(0, 6);
    list.innerHTML = '';
    if (log.length === 0) {
      list.innerHTML = '<span class="cr-recent-empty">아직 없습니다</span>';
      return;
    }
    log.forEach((entry) => {
      const time = new Date(entry.time);
      const shown = entry.winners.slice(0, 4).join(', ');
      const rest = entry.winners.length > 4 ? ` 외 ${entry.winners.length - 4}명` : '';
      const who = entry.genderFilter && entry.genderFilter !== 'all' ? `${FILTER_LABEL[entry.genderFilter]} · ` : '';
      const item = document.createElement('div');
      item.className = 'cr-recent-item';
      item.innerHTML = `<b>${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}</b>
        <em>${who}${entry.presetTitle}</em> <span>${shown}${rest}</span>`;
      list.append(item);
    });
  }

  // ---------------------------------------------------------------- 상태 변경

  private selectPreset(preset: Preset) {
    this.preset = preset;
    document.querySelectorAll('.cr-mode').forEach((card) => {
      card.classList.toggle('active', (card as HTMLElement).dataset.preset === preset.id);
    });

    // 프리셋이 권장 속도와 스킬 설정을 들고 온다. 교사가 슬라이더로 다시 바꿀 수 있다
    this.speed = preset.speed;
    $<HTMLInputElement>('#rngSpeed').value = String(preset.speed);
    $('#speedLabel').textContent = `${preset.speed}×`;
    $<HTMLInputElement>('#chkSkills').checked = preset.useSkills;
    options.useSkills = preset.useSkills;

    this.renderModeExtra();
    this.renderPool();
    this.syncMarbles();
  }

  private setGenderFilter(filter: GenderFilter) {
    this.genderFilter = filter;
    this.renderPool();
    this.syncMarbles();
  }

  private toggleAbsent(name: string) {
    const index = this.day.absent.indexOf(name);
    if (index >= 0) this.day.absent.splice(index, 1);
    else this.day.absent.push(name);
    store.saveDayState(this.rosterId, this.day);
    this.renderPool();
    this.syncMarbles();
  }

  private switchRoster(id: string) {
    this.rosterId = id;
    store.setActiveRosterId(id);
    this.day = store.loadDayState(id);
    // 반이 바뀌면 이전 반 기준의 성별 조건은 의미가 없다
    this.genderFilter = 'all';
    this.renderPool();
    this.syncMarbles();
  }

  /** 대기 화면에도 실제 참가자 구슬이 놓여 있도록 맞춰준다 */
  private syncMarbles() {
    if (this.currentMap !== this.preset.map) {
      this.roulette.setMap(this.preset.map);
      this.currentMap = this.preset.map;
    }
    this.roulette.setMarbles(this.pool());
  }

  private applyTheme() {
    const dark = $<HTMLInputElement>('#chkDark').checked;
    this.roulette.setTheme(dark ? 'dark' : 'light');
    document.documentElement.classList.toggle('light', !dark);
  }

  // ---------------------------------------------------------------- 라운드

  private beginRound() {
    const pool = this.pool();
    if (pool.length < 2) {
      toast(
        this.day.drawn.length > 0 ? '남은 사람이 부족합니다. 기록을 초기화하세요' : '참가자가 2명 이상이어야 합니다'
      );
      return;
    }
    const count = this.drawCount(pool.length);

    this.syncMarbles();

    // 꼴찌 뽑기는 뒤에서부터 센다
    if (this.preset.fromLast) {
      this.roulette.setWinnerRange(pool.length - count, pool.length - 1);
    } else {
      this.roulette.setWinnerRange(0, count - 1);
    }

    options.useSkills = $<HTMLInputElement>('#chkSkills').checked;
    this.roulette.setSpeed(this.speed);

    $('#panel').classList.add('hidden');
    $('#result').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    $('#hudMode').textContent = `${this.preset.emoji} ${this.preset.title} · ${this.startLabel(pool.length)}`;

    this.roulette.start();
  }

  /** 결과창을 닫고 설정 화면으로. 이어하기 기록은 그대로 둔다 */
  private goHome() {
    this.roulette.reset();
    // reset()이 맵을 다시 깔았으니 syncMarbles가 맵을 건너뛰지 않도록 표시를 지운다
    this.currentMap = -1;
    $('#hud').classList.add('hidden');
    $('#result').classList.add('hidden');
    $('#panel').classList.remove('hidden');
    this.renderPool();
    this.syncMarbles();
  }

  /** 누적을 비우고 처음부터. 결석 체크는 살려둔다 */
  private freshStart() {
    this.day.drawn = [];
    store.saveDayState(this.rosterId, this.day);
    this.goHome();
    toast('기록을 지웠습니다. 전원 참가');
  }

  private onGoal(winners: string[]) {
    // 순서·모둠 모드는 전원이 뽑힌 것이라, 여기서 '뽑힘'으로 기록하면 명단이 비어버린다
    if (this.preset.resultKind === 'winners') {
      winners.forEach((name) => {
        if (!this.day.drawn.includes(name)) this.day.drawn.push(name);
      });
      store.saveDayState(this.rosterId, this.day);
    }

    store.appendLog({
      time: Date.now(),
      rosterName: this.roster.name,
      presetTitle: this.preset.title,
      genderFilter: this.genderFilter,
      winners,
      streak: this.day.drawn.length,
    });

    setTimeout(() => this.showResult(winners), RESULT_DELAY_MS);
  }

  private showResult(winners: string[]) {
    $('#hud').classList.add('hidden');
    const who = this.genderFilter === 'all' ? '' : `${FILTER_LABEL[this.genderFilter]} · `;
    $('#resultTitle').textContent = `${this.preset.emoji} ${who}${this.preset.resultTitle}`;

    const body = $('#resultBody');
    body.innerHTML = '';
    body.className = `cr-result-body kind-${this.preset.resultKind}`;

    if (this.preset.resultKind === 'winners') {
      // 인원이 적을수록 크게 띄운다. 교실 뒤에서도 읽혀야 한다
      const size = winners.length <= 2 ? 'huge' : winners.length <= 6 ? 'big' : 'normal';
      body.classList.add(size);
      winners.forEach((name) => {
        const el = document.createElement('div');
        el.className = 'cr-winner';
        el.textContent = name;
        body.append(el);
      });
    } else if (this.preset.resultKind === 'order') {
      winners.forEach((name, i) => {
        const el = document.createElement('div');
        el.className = 'cr-order-item';
        el.innerHTML = `<b>${i + 1}</b><span>${name}</span>`;
        body.append(el);
      });
    } else {
      const teamCount = Math.max(2, Math.min(this.inputCounts[this.preset.id], winners.length));
      const hasGender = store.hasGenderInfo(this.roster.members);
      const genderOf = new Map(this.roster.members.map((member) => [member.name, member.gender]));

      const teams =
        hasGender && this.mixGender
          ? splitIntoTeamsMixed(
              winners.map((name) => ({ name, gender: genderOf.get(name) ?? 'x' })),
              teamCount
            )
          : splitIntoTeams(winners, teamCount);

      teams.forEach((members, i) => {
        const el = document.createElement('div');
        el.className = 'cr-team';
        const names = members.map((m) => `<span class="g-${genderOf.get(m) ?? 'x'}">${m}</span>`).join('');
        // 남녀가 실제로 흩어졌는지 모둠마다 숫자로 보여준다
        const male = members.filter((m) => genderOf.get(m) === 'm').length;
        const female = members.filter((m) => genderOf.get(m) === 'f').length;
        const mix = hasGender ? ` <i>남${male}·여${female}</i>` : '';
        el.innerHTML = `<h3>${i + 1}모둠 <em>${members.length}명</em>${mix}</h3>${names}`;
        body.append(el);
      });
    }

    // 다음 판에 몇 명이 남는지 미리 알려준다. '한 번 더'를 눌러도 되는 상황인지 바로 보인다
    const drawn = this.day.drawn.length;
    const left = this.pool().length;
    $('#resultNote').textContent =
      drawn > 0 ? `지금까지 ${drawn}명 뽑았습니다. 이어서 뽑으면 ${left}명 중에서 고릅니다.` : '';

    $('#result').classList.remove('hidden');
    this.renderRecent();
    this.renderPool();
  }

  // ---------------------------------------------------------------- 명단 편집

  private openRosterModal(isNew: boolean) {
    const roster: store.Roster = isNew
      ? { id: store.newRosterId(), name: '', mode: 'number', members: store.makeNumberMembers(24) }
      : this.roster;
    const modal = $('#rosterModal');
    this.editMembers = roster.members.map((member) => ({ ...member }));

    $<HTMLInputElement>('#rosterName').value = roster.name;
    $<HTMLTextAreaElement>('#rosterMembers').value =
      roster.mode === 'name' ? roster.members.map((m) => m.name).join('\n') : '';
    $<HTMLInputElement>('#rosterCount').value = String(roster.mode === 'number' ? roster.members.length : 24);
    $<HTMLInputElement>('#quickMale').value = String(this.editMembers.filter((m) => m.gender === 'm').length);

    modal.dataset.editing = roster.id;
    modal.dataset.isNew = String(isNew);
    $<HTMLButtonElement>('#btnDeleteRoster').style.display = isNew || this.rosters.length <= 1 ? 'none' : '';
    this.setRosterMode(roster.mode);
    modal.classList.remove('hidden');
    $<HTMLInputElement>('#rosterName').focus();
  }

  /** 명단 방식 탭을 바꾸고, 그 방식에 필요한 입력만 남긴다 */
  private setRosterMode(mode: store.RosterMode) {
    $('#rosterModal').dataset.mode = mode;
    document.querySelectorAll('#rosterMode button').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
    });
    const isNumber = mode === 'number';
    $('#fieldCount').classList.toggle('hidden', !isNumber);
    $('#numberPreview').classList.toggle('hidden', !isNumber);
    $('#fieldNames').classList.toggle('hidden', isNumber);
    $('#nameWarn').classList.toggle('hidden', isNumber);
    this.syncEditMembers();
  }

  /**
   * 지금 켜져 있는 입력(학생 수 또는 이름 목록)에 맞춰 편집 중인 명단을 다시 만든다.
   * 이미 정해둔 성별은 최대한 살린다.
   */
  private syncEditMembers() {
    const mode = ($('#rosterModal').dataset.mode ?? 'number') as store.RosterMode;

    if (mode === 'number') {
      const count = Math.max(0, Number.parseInt($<HTMLInputElement>('#rosterCount').value, 10) || 0);
      const next = store.makeNumberMembers(count).slice(0, count);
      // 번호는 순서가 곧 사람이라 인덱스로 성별을 물려받는다
      this.editMembers = next.map((member, i) => ({ ...member, gender: this.editMembers[i]?.gender ?? 'x' }));
    } else {
      const previous = new Map(this.editMembers.map((member) => [member.name, member.gender]));
      this.editMembers = store
        .parseMembers($<HTMLTextAreaElement>('#rosterMembers').value)
        .map((name) => ({ name, gender: previous.get(name) ?? 'x' }));
    }

    this.renderNumberPreview();
    this.renderGenderGrid();
  }

  private renderNumberPreview() {
    const count = this.editMembers.length;
    $('#numberPreview').textContent = count > 0 ? `1번 ~ ${count}번, 모두 ${count}명` : '학생 수를 넣어주세요';
  }

  private renderGenderGrid() {
    const grid = $('#genderGrid');
    grid.innerHTML = '';
    if (this.editMembers.length === 0) {
      grid.innerHTML = '<span class="cr-recent-empty">명단을 먼저 넣어주세요</span>';
      return;
    }

    const male = this.editMembers.filter((m) => m.gender === 'm').length;
    const female = this.editMembers.filter((m) => m.gender === 'f').length;
    const summary = document.createElement('div');
    summary.className = 'cr-gender-summary';
    summary.textContent = `남 ${male}명 · 여 ${female}명 · 미지정 ${this.editMembers.length - male - female}명`;
    grid.append(summary);

    this.editMembers.forEach((member, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `cr-gchip g-${member.gender}`;
      chip.innerHTML = `${member.name}<em>${store.genderLabel(member.gender)}</em>`;
      chip.addEventListener('click', () => {
        // 남 → 여 → 미지정 순환
        const next: store.Gender = member.gender === 'm' ? 'f' : member.gender === 'f' ? 'x' : 'm';
        this.editMembers[i] = { ...member, gender: next };
        this.renderGenderGrid();
      });
      grid.append(chip);
    });
  }

  private saveRosterModal() {
    const modal = $('#rosterModal');
    const id = modal.dataset.editing!;
    const isNew = modal.dataset.isNew === 'true';
    const mode = (modal.dataset.mode ?? 'number') as store.RosterMode;
    const name = $<HTMLInputElement>('#rosterName').value.trim() || '이름 없는 반';

    this.syncEditMembers();
    const members = this.editMembers.map((member) => ({ ...member }));

    if (members.length < 2) {
      toast(mode === 'number' ? '학생 수는 2명 이상이어야 합니다' : '학생 이름을 두 명 이상 넣어주세요');
      return;
    }

    if (isNew) {
      this.rosters.push({ id, name, mode, members });
    } else {
      const roster = this.rosters.find((r) => r.id === id);
      if (!roster) return;
      roster.name = name;
      roster.mode = mode;
      roster.members = members;
    }
    store.saveRosters(this.rosters);

    modal.classList.add('hidden');
    this.switchRoster(id);
    this.renderRosterSelect();
  }

  private deleteRoster() {
    const id = $('#rosterModal').dataset.editing!;
    if (this.rosters.length <= 1) return;
    if (!window.confirm('이 반 명단을 삭제할까요?')) return;
    this.rosters = this.rosters.filter((r) => r.id !== id);
    store.saveRosters(this.rosters);
    $('#rosterModal').classList.add('hidden');
    this.switchRoster(this.rosters[0].id);
    this.renderRosterSelect();
  }

  // ---------------------------------------------------------------- 이벤트

  private bindEvents() {
    $('#btnStart').addEventListener('click', () => this.beginRound());
    $('#btnAbort').addEventListener('click', () => this.goHome());
    $('#btnAgain').addEventListener('click', () => this.beginRound());
    $('#btnContinue').addEventListener('click', () => this.goHome());
    $('#btnFresh').addEventListener('click', () => this.freshStart());

    document.querySelectorAll<HTMLElement>('#genderFilter button').forEach((btn) => {
      btn.addEventListener('click', () => this.setGenderFilter(btn.dataset.g as GenderFilter));
    });

    $<HTMLSelectElement>('#rosterSelect').addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      if (value === '__new__') {
        $<HTMLSelectElement>('#rosterSelect').value = this.rosterId;
        this.openRosterModal(true);
        return;
      }
      this.switchRoster(value);
    });

    $('#btnEditRoster').addEventListener('click', () => this.openRosterModal(false));
    document.querySelectorAll('#rosterMode button').forEach((btn) => {
      btn.addEventListener('click', () => this.setRosterMode((btn as HTMLElement).dataset.mode as store.RosterMode));
    });
    $('#rosterCount').addEventListener('input', () => this.syncEditMembers());
    $('#rosterMembers').addEventListener('input', () => this.syncEditMembers());
    $('#btnSaveRoster').addEventListener('click', () => this.saveRosterModal());
    $('#btnCancelRoster').addEventListener('click', () => $('#rosterModal').classList.add('hidden'));
    $('#btnDeleteRoster').addEventListener('click', () => this.deleteRoster());

    $('#btnQuickGender').addEventListener('click', () => {
      const male = Math.max(0, Number.parseInt($<HTMLInputElement>('#quickMale').value, 10) || 0);
      this.editMembers = store.assignByOrder(this.editMembers, male);
      this.renderGenderGrid();
    });

    $('#btnClearGender').addEventListener('click', () => {
      this.editMembers = this.editMembers.map((member) => ({ ...member, gender: 'x' }));
      $<HTMLInputElement>('#quickMale').value = '0';
      this.renderGenderGrid();
    });

    $('#btnResetDay').addEventListener('click', () => {
      this.day = { date: store.today(), absent: [], drawn: [] };
      store.saveDayState(this.rosterId, this.day);
      this.renderPool();
      this.syncMarbles();
      toast('기록과 결석 체크를 지웠습니다');
    });

    $<HTMLInputElement>('#chkSkills').addEventListener('change', (e) => {
      options.useSkills = (e.target as HTMLInputElement).checked;
    });

    $<HTMLInputElement>('#chkDark').addEventListener('change', () => this.applyTheme());

    $<HTMLInputElement>('#rngSpeed').addEventListener('input', (e) => {
      this.speed = Number.parseFloat((e.target as HTMLInputElement).value);
      $('#speedLabel').textContent = `${this.speed}×`;
    });

    this.roulette.addEventListener('goal', (e) => {
      this.onGoal((e as CustomEvent).detail.winners as string[]);
    });

    this.roulette.addEventListener('message', (e) => toast((e as CustomEvent).detail));

    // 스페이스바로 시작·이어하기. 수업 중에 마우스를 찾지 않아도 되게
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
      if (!$('#rosterModal').classList.contains('hidden')) return;
      if ($('#hud').classList.contains('hidden')) {
        e.preventDefault();
        this.beginRound();
      }
    });
  }
}
