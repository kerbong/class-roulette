import options from '../options';
import type { Roulette } from '../roulette';
import { type Preset, presets, splitIntoTeams } from './presets';
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

export class ClassroomApp {
  private rosters: store.Roster[] = [];
  private rosterId = '';
  private day: store.DayState = { date: store.today(), absent: [], drawn: [] };
  private preset: Preset = presets[0];
  /** countMode가 'input'인 프리셋에서 교사가 넣은 숫자. 프리셋별로 기억한다 */
  private inputCounts: Record<string, number> = {};
  private excludeDrawn = true;
  private speed = 2;
  private currentMap = -1;

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

  /** 결석자를 빼고, 설정에 따라 오늘 이미 뽑힌 사람도 뺀 명단 */
  private pool(): string[] {
    return this.roster.members.filter((name) => {
      if (this.day.absent.includes(name)) return false;
      if (this.excludeDrawn && this.day.drawn.includes(name)) return false;
      return true;
    });
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
  }

  private renderPool() {
    const pool = this.pool();
    $('#poolCount').textContent = String(pool.length);

    const chips = $('#poolChips');
    chips.innerHTML = '';
    this.roster.members.forEach((name) => {
      const chip = document.createElement('button');
      chip.className = 'cr-chip';
      chip.textContent = name;
      if (this.day.absent.includes(name)) chip.classList.add('absent');
      else if (this.excludeDrawn && this.day.drawn.includes(name)) chip.classList.add('drawn');
      chip.addEventListener('click', () => this.toggleAbsent(name));
      chips.append(chip);
    });

    const startBtn = $<HTMLButtonElement>('#btnStart');
    const enough = pool.length >= 2;
    startBtn.disabled = !enough;
    startBtn.textContent = enough ? `시작!  ${this.startLabel(pool.length)}` : '참가자가 부족해요';
  }

  /** 시작 버튼에 "무슨 일이 일어날지"를 적어둔다 */
  private startLabel(poolSize: number): string {
    if (this.preset.resultKind === 'order') return '순서 정하기';
    if (this.preset.resultKind === 'teams') return `${this.inputCounts[this.preset.id]}모둠으로 나누기`;
    const count = this.drawCount(poolSize);
    return this.preset.fromLast ? `꼴찌 ${count}명 뽑기` : `${count}명 뽑기`;
  }

  private renderRecent() {
    const list = $('#recentList');
    const log = store.loadLog().slice(0, 5);
    list.innerHTML = '';
    if (log.length === 0) {
      list.innerHTML = '<span class="cr-recent-empty">아직 없습니다</span>';
      return;
    }
    log.forEach((entry) => {
      const time = new Date(entry.time);
      const shown = entry.winners.slice(0, 4).join(', ');
      const rest = entry.winners.length > 4 ? ` 외 ${entry.winners.length - 4}명` : '';
      const item = document.createElement('div');
      item.className = 'cr-recent-item';
      item.innerHTML = `<b>${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}</b>
        <em>${entry.presetTitle}</em> <span>${shown}${rest}</span>`;
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
      toast('참가자가 2명 이상이어야 합니다');
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
      winners,
    });

    setTimeout(() => this.showResult(winners), RESULT_DELAY_MS);
  }

  private showResult(winners: string[]) {
    $('#hud').classList.add('hidden');
    $('#resultTitle').textContent = `${this.preset.emoji} ${this.preset.resultTitle}`;

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
      splitIntoTeams(winners, teamCount).forEach((members, i) => {
        const el = document.createElement('div');
        el.className = 'cr-team';
        const names = members.map((m) => `<span>${m}</span>`).join('');
        el.innerHTML = `<h3>${i + 1}모둠 <em>${members.length}명</em></h3>${names}`;
        body.append(el);
      });
    }

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
    $<HTMLInputElement>('#rosterName').value = roster.name;
    $<HTMLTextAreaElement>('#rosterMembers').value = roster.mode === 'name' ? roster.members.join('\n') : '';
    $<HTMLInputElement>('#rosterCount').value = String(roster.mode === 'number' ? roster.members.length : 24);
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
    this.renderNumberPreview();
  }

  private renderNumberPreview() {
    const count = Number.parseInt($<HTMLInputElement>('#rosterCount').value, 10) || 0;
    $('#numberPreview').textContent = count > 0 ? `1번 ~ ${count}번, 모두 ${count}명` : '학생 수를 넣어주세요';
  }

  private saveRosterModal() {
    const modal = $('#rosterModal');
    const id = modal.dataset.editing!;
    const isNew = modal.dataset.isNew === 'true';
    const mode = (modal.dataset.mode ?? 'number') as store.RosterMode;
    const name = $<HTMLInputElement>('#rosterName').value.trim() || '이름 없는 반';

    const members =
      mode === 'number'
        ? store.makeNumberMembers(Number.parseInt($<HTMLInputElement>('#rosterCount').value, 10) || 0)
        : store.parseMembers($<HTMLTextAreaElement>('#rosterMembers').value);

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
    $('#btnHome').addEventListener('click', () => this.goHome());
    $('#btnAgain').addEventListener('click', () => this.beginRound());

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
    $('#rosterCount').addEventListener('input', () => this.renderNumberPreview());
    $('#btnSaveRoster').addEventListener('click', () => this.saveRosterModal());
    $('#btnCancelRoster').addEventListener('click', () => $('#rosterModal').classList.add('hidden'));
    $('#btnDeleteRoster').addEventListener('click', () => this.deleteRoster());

    $<HTMLInputElement>('#chkExcludeDrawn').addEventListener('change', (e) => {
      this.excludeDrawn = (e.target as HTMLInputElement).checked;
      this.renderPool();
      this.syncMarbles();
    });

    $('#btnResetDay').addEventListener('click', () => {
      this.day = { date: store.today(), absent: [], drawn: [] };
      store.saveDayState(this.rosterId, this.day);
      this.renderPool();
      this.syncMarbles();
      toast('오늘 기록을 지웠습니다');
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

    // 스페이스바로 시작·다시하기. 수업 중에 마우스를 찾지 않아도 되게
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
