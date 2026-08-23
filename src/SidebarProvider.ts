import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { SessionState, WebviewMessage } from './types';

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private lastSessions: SessionState[] = [];
  private messageDisposable?: vscode.Disposable;
  private viewDisposable?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onToggle: (id: string) => void,
    private readonly onReset: (id: string) => void,
    private readonly onPingNow: (id: string) => void,
    private readonly onDismiss: (id: string) => void
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.messageDisposable?.dispose();
    this.viewDisposable?.dispose();
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.messageDisposable = webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      if (msg.type === 'toggle') this.onToggle(msg.sessionId);
      if (msg.type === 'reset') this.onReset(msg.sessionId);
      if (msg.type === 'pingNow') this.onPingNow(msg.sessionId);
      if (msg.type === 'dismiss') this.onDismiss(msg.sessionId);
    });
    this.viewDisposable = webviewView.onDidDispose(() => {
      this.messageDisposable?.dispose();
      this.messageDisposable = undefined;
      this.viewDisposable = undefined;
      if (this.view === webviewView) { this.view = undefined; }
    });

    // Push current state on first load
    if (this.lastSessions.length > 0) {
      this.push(this.lastSessions);
    }
  }

  push(sessions: SessionState[]) {
    this.lastSessions = sessions;
    this.view?.webview.postMessage({ type: 'stateUpdate', sessions });
  }

  dispose(): void {
    this.messageDisposable?.dispose();
    this.viewDisposable?.dispose();
    this.messageDisposable = undefined;
    this.viewDisposable = undefined;
    this.view = undefined;
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const nonce = randomBytes(16).toString('hex');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CacheWarden</title>
  <style>
    html, body, #root { margin: 0; min-width: 0; }
    *, *::before, *::after { box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
