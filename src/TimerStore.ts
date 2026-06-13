import * as vscode from 'vscode';

export interface TimerSnapshot {
  secondsRemaining: number;
  expired: boolean;
}

export class TimerStore implements vscode.Disposable {
  private _secondsRemaining: number;
  private baselineIdleMs = 0;

  readonly onChange: vscode.Event<TimerSnapshot>;
  private readonly _onChange = new vscode.EventEmitter<TimerSnapshot>();

  constructor(private ttlSeconds: number) {
    this._secondsRemaining = ttlSeconds;
    this.onChange = this._onChange.event;
  }

  tick(idleMs: number) {
    const effectiveIdleMs = Math.max(0, idleMs - this.baselineIdleMs);
    const idleSecs = Math.floor(effectiveIdleMs / 1000);
    this._secondsRemaining = Math.max(0, this.ttlSeconds - idleSecs);
    this._onChange.fire(this.snapshot());
  }

  reset(idleMs = 0) {
    this.baselineIdleMs = idleMs;
    this._secondsRemaining = this.ttlSeconds;
    this._onChange.fire(this.snapshot());
  }

  updateTtl(ttlSeconds: number) {
    this.ttlSeconds = ttlSeconds;
    this._secondsRemaining = Math.min(this._secondsRemaining, ttlSeconds);
    this._onChange.fire(this.snapshot());
  }

  get secondsRemaining(): number {
    return this._secondsRemaining;
  }

  snapshot(): TimerSnapshot {
    return {
      secondsRemaining: this._secondsRemaining,
      expired: this._secondsRemaining === 0,
    };
  }

  dispose() {
    this._onChange.dispose();
  }
}
