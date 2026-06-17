import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logTrace } from "../../logging";

// for the browser-side mount/append code (executed inside the CEF browser)
declare const window: any;

// Frostfall delivers chat by setting this owner-visible property to a
// '#{rrggbb}text…' string. Its updateOwner script (which mounts the widget and
// renders messages) is signed and can be rejected by ServerJsVerificationService
// when the server's publicKeys don't match — silently killing chat. We bypass
// that by reading the property VALUE directly (it syncs regardless) and
// rendering it ourselves.
const CHAT_MSG_PROP = 'ff_chatMsg';

// Browser-side bootstrap: mount a chat widget (unless one already exists — e.g.
// Frostfall's own updateOwner mounted it, in which case we defer) and define a
// '#{color}'-parsing appender. window.mp.send('cef::chat:send', …) is exactly
// how Frostfall's own chat widget sends, so input still reaches the gamemode.
const CHAT_MOUNT_JS = `(function(){
  try {
    if (window.__skyrpChatReady) return;
    if (!window.skyrimPlatform || !window.skyrimPlatform.widgets) return;
    window.__skyrpChatReady = true;
    if (!window.chatMessages) window.chatMessages = [];
    var sf = function(t){ if (window.mp && typeof window.mp.send === 'function') window.mp.send('cef::chat:send', t); };
    var chatWidget = { type:'chat', id:'chat', isInputHidden:false, placeholder:'', messages: window.chatMessages.slice(), send: sf };
    window.__skyrpChatWidget = chatWidget;
    var cur = window.skyrimPlatform.widgets.get() || [];
    if (cur.some(function(w){ return w.type==='chat'; })) {
      window.__skyrpChatOwns = false; // someone (Frostfall) already owns chat
    } else {
      window.__skyrpChatOwns = true;
      window.skyrimPlatform.widgets.set([chatWidget].concat(cur));
    }
    window.__skyrpAddChat = function(raw){
      try {
        if (!window.__skyrpChatOwns) return;
        var parts = String(raw).split('#{'); var segs = []; var col = '#fafafa';
        for (var i=0;i<parts.length;i++){ var p = parts[i];
          if (i===0){ if(p) segs.push({text:p,color:col,opacity:1,type:['default']}); continue; }
          var ci = p.indexOf('}');
          if (ci===6){ col = '#'+p.slice(0,6); var txt = p.slice(7); if(txt) segs.push({text:txt,color:col,opacity:1,type:['default']}); }
          else { segs.push({text:'#{'+p,color:col,opacity:1,type:['default']}); }
        }
        if (!segs.length) return;
        window.chatMessages.push({text:segs, category:'plain', opacity:1});
        if (window.chatMessages.length > 100) window.chatMessages.shift();
        var w = window.skyrimPlatform.widgets.get() || [];
        var found = false;
        var next = w.map(function(x){ if (x.type!=='chat') return x; found = true; return Object.assign({}, x, {messages: window.chatMessages.slice()}); });
        if (!found) next = w.concat([Object.assign({}, window.__skyrpChatWidget, {messages: window.chatMessages.slice()})]);
        window.skyrimPlatform.widgets.set(next);
        if (typeof window.scrollToLastMessage === 'function') window.scrollToLastMessage();
      } catch (e) {}
    };
  } catch (e) {}
})();`;

/**
 * Makes the Frostfall chat work on the stock client without relying on the
 * gamemode's signed updateOwner script. It mounts the chat widget on spawn and,
 * each tick, reads the owner actor's `ff_chatMsg` property straight from the
 * synced model (the same place GamemodeUpdateService reads it) and renders any
 * new value. Sending goes out via `cef::chat:send`, which Frostfall handles.
 *
 * Registered after GamemodeUpdateService, so if Frostfall's own chat script DOES
 * verify and run, it mounts first and this service defers to it.
 */
export class ChatService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
  }

  private onUpdate(): void {
    // ownerModel is populated by GamemodeUpdateService once our actor spawns.
    if (this.sp.storage["ownerModelSet"] !== true) {
      return;
    }
    const owner = this.sp.storage["ownerModel"] as Record<string, unknown> | undefined;
    if (!owner) {
      return;
    }

    if (!this.mounted) {
      this.mounted = true;
      logTrace(this, "Mounting chat widget (reads ff_chatMsg directly)");
      this.sp.browser.executeJavaScript(CHAT_MOUNT_JS);
      this.sp.browser.setVisible(true);
    }

    const msg = owner[CHAT_MSG_PROP];
    if (typeof msg === "string" && msg !== "" && msg !== this.lastMsg) {
      this.lastMsg = msg;
      this.sp.browser.executeJavaScript(`window.__skyrpAddChat && window.__skyrpAddChat(${JSON.stringify(msg)});`);
    }
  }

  private mounted = false;
  private lastMsg: string | null = null;
}
