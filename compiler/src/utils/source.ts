export interface LineColumn {
  line: number;
  column: number;
}

export class SourceFile {
  readonly filename: string;
  readonly content: string;
  private lineOffsets: number[];

  constructor(filename: string, content: string) {
    this.filename = filename;
    this.content = content;
    this.lineOffsets = this.computeLineOffsets();
  }

  private computeLineOffsets(): number[] {
    const offsets: number[] = [0];
    for (let idx = 0; idx < this.content.length; idx++) {
      if (this.content[idx] === "\n") {
        offsets.push(idx + 1);
      } else if (this.content[idx] === "\r") {
        if (idx + 1 < this.content.length && this.content[idx + 1] === "\n") {
          idx++;
        }
        offsets.push(idx + 1);
      }
    }
    return offsets;
  }

  lineCol(offset: number): LineColumn {
    let low = 0;
    let high = this.lineOffsets.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.lineOffsets[mid] ?? 0) <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return {
      line: low + 1,
      column: offset - (this.lineOffsets[low] ?? 0) + 1,
    };
  }

  get length(): number {
    return this.content.length;
  }

  charAt(offset: number): string {
    return this.content[offset] ?? "";
  }
}
