/**
 * 원본 프로젝트에서는 외부 서버(marblerouletteshop.com)에서 60초마다 키워드 스프라이트를
 * 내려받아 특정 이름의 구슬을 그림으로 바꿔준다. 교실용에서는 그 기능을 끈다.
 *
 * - 학생 이름이 외부로 나가지 않는다
 * - 학교 네트워크가 막혀 있거나 오프라인이어도 그대로 돌아간다
 *
 * rouletteRenderer가 기대하는 모양만 남긴 빈 껍데기다.
 */
export class KeywordService {
  async init(): Promise<void> {
    // 아무것도 하지 않는다
  }

  destroy(): void {
    // 아무것도 하지 않는다
  }

  getSprite(_marbleName: string): CanvasImageSource | undefined {
    return undefined;
  }
}
