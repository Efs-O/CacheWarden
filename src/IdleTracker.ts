import * as vscode from 'vscode';

export class IdleTracker implements vscode.Disposable {
  private lastActivityAt = Date.now();
  private readonly disposables: vscode.Disposable[] = [];
  private tickInterval: ReturnType<typeof setInterval> | undefined;

  readonly onTick: vscode.Event<number>;
  private readonly _onTick = new vscode.EventEmitter<number>();
  readonly onActivity: vscode.Event<void>;
  private readonly _onActivity = new vscode.EventEmitter<void>();

  constructor() {
    this.onTick = this._onTick.event;
    this.onActivity = this._onActivity.event;

    const bump = () => {
      this.lastActivityAt = Date.now();
      this._onActivity.fire();
    };

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(bump),
      vscode.window.onDidChangeActiveTextEditor(bump),
      vscode.window.onDidChangeTextEditorSelection(bump),
      vscode.window.onDidOpenTerminal(bump)
    );

    this.tickInterval = setInterval(() => {
      this._onTick.fire(Date.now() - this.lastActivityAt);
    }, 1000);
  }

  resetIdle() {
    this.lastActivityAt = Date.now();
  }

  get idleMs(): number {
    return Date.now() - this.lastActivityAt;
  }

  dispose() {
    clearInterval(this.tickInterval);
    this._onTick.dispose();
    this._onActivity.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
