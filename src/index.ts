import './localization';
import { ClassroomApp } from './classroom/app';
import options from './options';
import { Roulette } from './roulette';

const roulette = new Roulette();

// 교실용은 녹화가 기본으로 꺼져 있어야 한다. 수업 중에 저장 대화상자가 뜨면 흐름이 끊긴다
options.autoRecording = false;
roulette.setAutoRecording(false);

// 물리 엔진(box2d-wasm)이 준비돼야 맵과 구슬을 올릴 수 있다
function boot() {
  if (!roulette.isReady) {
    setTimeout(boot, 50);
    return;
  }
  new ClassroomApp(roulette).start();
}

document.addEventListener('DOMContentLoaded', boot);

// 콘솔에서 들여다볼 수 있게 열어둔다
(window as any).roulette = roulette;
