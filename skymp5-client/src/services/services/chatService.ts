import { ClientListener, CombinedController, Sp } from "./clientListener";
import { logTrace } from "../../logging";
import { BrowserMessageEvent } from "skyrimPlatform";
import { MsgType } from "../../messages";

declare const window: any;

const CHAT_MSG_PROP = 'ff_chatMsg';

// Skyrim world units per meter ~69.99.
const UNITS_PER_METER = 70;

const buildMountJs = (name: string, isAdmin: boolean) => `(function(){
  try {
    if (window.__skyrpChatReady) return;
    if (!window.skyrimPlatform || !window.skyrimPlatform.widgets) return;
    window.__skyrpChatReady = true;
    window.__skyrpAdmin = ${isAdmin ? 'true' : 'false'};
    if (!window.chatMessages) window.chatMessages = [];

    // Force the chat to the upper-left corner.
    if (!document.getElementById('skyrpChatCss')) {
      var st = document.createElement('style');
      st.id = 'skyrpChatCss';
      st.innerHTML = '#chat{top:24px!important;left:24px!important;right:auto!important;bottom:auto!important;}';
      document.head.appendChild(st);
    }

    var WHITE='#fafafa';
    var ME='#c2a3da';
    var OOC='#3896f3';
    var SHOUT='#772021';
    var SYS='#eda841';
    var PM='#4ec9b0';
    var NAME='#fbf724';

    var DARKEN_RANGE_M=80;
    var CH = {
      say:     {color:WHITE,  range:20,  tab:'local',    fmt:'say'},
      low:     {color:WHITE,  range:10,  tab:'local',    fmt:'sayquiet'},
      whisper: {color:WHITE,  range:3,   tab:'local',    fmt:'whisper'},
      wide:    {color:WHITE,  range:80,  tab:'local',    fmt:'sayloud'},
      shout:   {color:SHOUT,  range:160, tab:'local',    fmt:'shout'},
      me:      {color:ME,     range:20,  tab:'local',    fmt:'me'},
      melow:   {color:ME,     range:10,  tab:'local',    fmt:'me'},
      melong:  {color:ME,     range:80,  tab:'local',    fmt:'me'},
      my:      {color:ME,     range:20,  tab:'local',    fmt:'my'},
      mylow:   {color:ME,     range:10,  tab:'local',    fmt:'my'},
      mylong:  {color:ME,     range:80,  tab:'local',    fmt:'my'},
      do:      {color:ME,     range:20,  tab:'local',    fmt:'do'},
      dolow:   {color:ME,     range:10,  tab:'local',    fmt:'do'},
      dolong:  {color:ME,     range:80,  tab:'local',    fmt:'do'},
      ooc:     {color:OOC,    range:20,  tab:'local',    fmt:'ooc', oocLabel:'OOC'},
      ooclow:  {color:OOC,    range:10,  tab:'local',    fmt:'ooc', oocLabel:'OOC - Low'},
      ooclong: {color:OOC,    range:80,  tab:'local',    fmt:'ooc', oocLabel:'OOC - Long'},
      system:  {color:SYS,    range:0,   tab:'all',      fmt:'plain', admin:1},
      flavor:  {color:SYS,    range:0,   tab:'system',   fmt:'plain'},
      pm:      {color:PM,     range:0,   tab:'personal', fmt:'pm'}
    };

    var ALIAS = {
      l:'low',
      w:'whisper',
      long:'wide',
      s:'shout', y:'shout', yell:'shout',
      mel:'melow', mew:'melong', mewide:'melong',
      myl:'mylow', myw:'mylong', mywide:'mylong',
      dol:'dolow', dow:'dolong', dowide:'dolong',
      b:'ooc', looc:'ooc',
      bl:'ooclow', loocl:'ooclow', oocl:'ooclow', blow:'ooclow', looclow:'ooclow',
      bw:'ooclong', loocw:'ooclong', oocw:'ooclong', bwide:'ooclong', loocwide:'ooclong', blong:'ooclong', looclong:'ooclong',
      dm:'pm', to:'pm', too:'pm'
    };

    if (!window.__skyrpNames) window.__skyrpNames = [];
    window.__skyrpSetNames=function(full){
      window.__skyrpName=String(full==null?'':full);
      var parts=window.__skyrpName.trim().split(' ').filter(function(x){ return x.length; });
      var arr=[];
      if (window.__skyrpName.trim()) arr.push(window.__skyrpName.trim());
      if (parts.length>1){ arr.push(parts[0]); arr.push(parts[parts.length-1]); }
      var seen={}, out=[];
      for (var i=0;i<arr.length;i++){ var k=arr[i].toLowerCase(); if(!seen[k]){ seen[k]=1; out.push(arr[i]); } }
      window.__skyrpNames=out;
    };
    window.__skyrpSetNames(${JSON.stringify(name)});

    function isWordChar(ch){
      return (ch>='a'&&ch<='z')||(ch>='A'&&ch<='Z')||(ch>='0'&&ch<='9');
    }
    // Re-colour any character name (whole-word, case-insensitive) to NAME.
    function highlightNames(segs){
      var names=(window.__skyrpNames||[]).filter(function(n){ return n && n.length>1; });
      if (!names.length) return segs;
      names=names.slice().sort(function(a,b){ return b.length-a.length; }); // longest first
      var out=[];
      for (var s=0;s<segs.length;s++){
        var seg=segs[s];
        if (seg.color===NAME){ out.push(seg); continue; }
        var text=seg.text, low=text.toLowerCase(), pos=0;
        while (pos<text.length){
          var best=-1, bestLen=0;
          for (var k=0;k<names.length;k++){
            var nm=names[k].toLowerCase(), idx=low.indexOf(nm,pos);
            while (idx>=0){
              var before=idx>0?text.charAt(idx-1):' ';
              var after=idx+nm.length<text.length?text.charAt(idx+nm.length):' ';
              if (!isWordChar(before) && !isWordChar(after)) break;
              idx=low.indexOf(nm,idx+1);
            }
            if (idx>=0 && (best===-1 || idx<best)){ best=idx; bestLen=nm.length; }
          }
          if (best===-1){ out.push({text:text.slice(pos),color:seg.color}); break; }
          if (best>pos) out.push({text:text.slice(pos,best),color:seg.color});
          out.push({text:text.slice(best,best+bestLen),color:NAME});
          pos=best+bestLen;
        }
      }
      return out;
    }

    function darken(hex, t){
      t=t<0?0:(t>1?1:t);
      var f=1-t*0.6;
      var h=hex.charAt(0)==='#'?hex.slice(1):hex;
      if (h.length===3) h=h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
      var r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
      if (isNaN(r)||isNaN(g)||isNaN(b)) return hex;
      function hx(v){ v=Math.round(v); v=v<0?0:(v>255?255:v); var x=v.toString(16); return x.length<2?'0'+x:x; }
      return '#'+hx(r*f)+hx(g*f)+hx(b*f);
    }
    function darkenSegs(segs, t){
      if (!(t>0)) return segs;
      return segs.map(function(seg){
        return { text:seg.text, color: seg.color===NAME ? seg.color : darken(seg.color,t) };
      });
    }

    // Allows "quoted text" to appear as /say
    function quoteSegs(text, base){
      var segs=[], re=/"([^"]*)"/g, last=0, m;
      while ((m=re.exec(text))){
        if (m.index>last) segs.push({text:text.slice(last,m.index),color:base});
        segs.push({text:'"'+m[1]+'"',color:WHITE});
        last=re.lastIndex;
      }
      if (last<text.length) segs.push({text:text.slice(last),color:base});
      return segs;
    }

    // Build the coloured segments for a line.
    function fmtLine(kind, n, body){
      var ch=CH[kind], c=ch.color, f=ch.fmt;
      if (f==='say')     return [{text:n+' says: "'+body+'"',color:c}];
      if (f==='sayquiet')return [{text:n+' says quietly: "'+body+'"',color:c}];
      if (f==='whisper') return [{text:n+' whispers: "'+body+'"',color:c}];
      if (f==='sayloud') return [{text:n+' says loudly: "'+body+'"',color:c}];
      if (f==='shout')   return [{text:n+' shouts: "'+body+'"',color:c}];
      if (f==='me')      return [{text:n+' ',color:c}].concat(quoteSegs(body,c));
      if (f==='my')      return [{text:n+"'s ",color:c}].concat(quoteSegs(body,c));
      if (f==='do')      return quoteSegs(body,c);
      if (f==='ooc')     return [{text:n+' ('+ch.oocLabel+'): "'+body+'"',color:c}];
      return [{text:body,color:c}]; // plain: system / flavour
    }

    // Parse a typed line. No slash = /say.
    function parse(raw){
      var text=String(raw).trim(); if(!text) return null;
      var kind='say', body=text;
      if (text.charAt(0)==='/'){
        var i=text.indexOf(' ');
        var cmd=(i<0?text:text.slice(0,i)).slice(1).toLowerCase();
        body=(i<0?'':text.slice(i+1)).trim();
        kind=ALIAS[cmd]||cmd;
        if (!CH[kind]){ return { command:true }; }
      }
      var ch=CH[kind];
      if (ch.admin && !window.__skyrpAdmin) return { denied:true };
      if (kind==='pm'){
        var i2=body.indexOf(' ');
        var target=i2<0?body:body.slice(0,i2);
        var pmText=i2<0?'':body.slice(i2+1).trim();
        if (!target || !pmText) return { error:'Usage: /pm <player|account|id> <message>' };
        return { kind:kind, segs:[{text:'To '+target+': '+pmText,color:PM}], tab:'personal' };
      }
      if (!body) return null;
      var n=window.__skyrpName||'You';
      return { kind:kind, segs:fmtLine(kind,n,body), tab:ch.tab };
    }

    // Merge neighbouring runs of the same colour (tidies up the name/quote splits).
    function mergeSegs(segs){
      var out=[];
      for (var i=0;i<segs.length;i++){
        var s=segs[i];
        if (out.length && out[out.length-1].color===s.color) out[out.length-1].text+=s.text;
        else out.push({text:s.text,color:s.color});
      }
      return out;
    }
    function pushSegs(segs, tab){
      var t=mergeSegs(highlightNames(segs)).map(function(s){ return {text:s.text,color:s.color,opacity:1,type:['default']}; });
      window.chatMessages.push({text:t, category:'plain', opacity:1, channel:tab});
      if (window.chatMessages.length>100) window.chatMessages.shift();
      var w=window.skyrimPlatform.widgets.get()||[];
      window.skyrimPlatform.widgets.set(w.map(function(x){
        return x.type!=='chat' ? x : Object.assign({}, x, {messages:window.chatMessages.slice()});
      }));
      if (typeof window.scrollToLastMessage==='function') window.scrollToLastMessage();
    }

    // Local echo + send to server.
    var sf=function(raw){
      var p=parse(raw); if(!p) return;
	  if (p.command){ if (window.skyrimPlatform && window.skyrimPlatform.sendMessage) window.skyrimPlatform.sendMessage('cef::chat:send', raw); return; }
      if (p.denied){ pushSegs([{text:'Only admins can use that command.',color:SYS}],'all'); return; }
      if (p.error){ pushSegs([{text:p.error,color:SYS}],'personal'); return; }
      pushSegs(p.segs, p.tab);
      if (window.skyrimPlatform && window.skyrimPlatform.sendMessage) window.skyrimPlatform.sendMessage('cef::chat:send', raw);
    };

    var chatWidget={ type:'chat', id:'chat', isInputHidden:false, placeholder:'', messages:window.chatMessages.slice(), send:sf };
    window.__skyrpChatWidget=chatWidget;
    var cur=(window.skyrimPlatform.widgets.get()||[]).filter(function(w){ return w.type!=='chat'; });
    window.skyrimPlatform.widgets.set([chatWidget].concat(cur)); // always own chat

    // Incoming text from the server / other players and distance dimming
    window.__skyrpAddChat=function(raw, dist){
      var s=String(raw);
      // Strip the server's "<nonce>" prefix (makes repeats unique so they render).
      var us=s.indexOf('\\u001f');
      if (us>0 && /^[0-9]+$/.test(s.slice(0,us))) s=s.slice(us+1);
      var bubbleRefr=0;
	  if (s.indexOf('[[B')===0){ var be=s.indexOf(']]'); var hex=be>3?s.slice(3,be):''; if (hex && /^[0-9a-fA-F]+$/.test(hex)){ bubbleRefr=parseInt(hex,16); s=s.slice(be+2); } }
      // Private messages
      if (s.indexOf('[[PM]]')===0){
        var rest=s.slice(6), bar=rest.indexOf('|');
        var sender=bar<0?'PM':rest.slice(0,bar), pmTxt=bar<0?rest:rest.slice(bar+1);
        pushSegs([{text:sender+': '+pmTxt,color:PM}],'personal');
        return;
      }
      // Channel tag -> tab. Untagged lines are local (spoken / emote / ooc).
      var tab='local';
      if (s.indexOf('[[G]]')===0){ tab='local'; s=s.slice(5); }      // legacy global -> local
      else if (s.indexOf('[[S]]')===0){ tab='all'; s=s.slice(5); }
      else if (s.indexOf('[[A]]')===0){ tab='admin'; s=s.slice(5); }
      // Parse a '#{rrggbb}text' coloured line.
      var parts=s.split('#{'), segs=[], col=WHITE;
      for (var i=0;i<parts.length;i++){ var p=parts[i];
        if (i===0){ if(p) segs.push({text:p,color:col}); continue; }
        var ci=p.indexOf('}');
        if (ci===6){ col='#'+p.slice(0,6); var txt=p.slice(7); if(txt) segs.push({text:txt,color:col}); }
        else segs.push({text:'#{'+p,color:col});
      }
      if (segs.length){
        var d=(typeof dist==='number')?dist:-1;
        if (d>0) segs=darkenSegs(segs, d/DARKEN_RANGE_M);
        pushSegs(segs,tab);
        if (bubbleRefr && window.skyrimPlatform && window.skyrimPlatform.sendMessage){
          window.skyrimPlatform.sendMessage('skyrpChatBubble', bubbleRefr, segs.map(function(x){ return x.text; }).join(''));
        }
      }
    };

    // Vanilla-style corner notifications system tab
    window.__skyrpAddSystem=function(text){
      var t=String(text==null?'':text); if(!t) return;
      pushSegs([{text:t,color:SYS}],'system');
    };

    // Lines triggered by spells, conditions, zones, etc
    window.__skyrpAddFlavor=function(text){
      var t=String(text==null?'':text); if(!t) return;
      pushSegs([{text:t,color:SYS}], CH.flavor.tab);
    };
  } catch (e) {}
})();`;

export class ChatService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    this.controller.on("update", () => this.onUpdate());
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
  }

  private onBrowserMessage(e: BrowserMessageEvent): void {
    if (e.arguments[0] === "skyrpChatBubble") {
      this.showBubble(Number(e.arguments[1] ?? 0), String(e.arguments[2] ?? ""));
      return;
    }
    if (e.arguments[0] === "cef::chat:send") {
      const text = String(e.arguments[1] ?? "");
      if (!text) return;
      this.controller.emitter.emit("sendMessage", {
        message: { t: MsgType.CustomPacket, contentJsonDump: JSON.stringify({ type: "cef::chat:send", data: text }) },
        reliability: "reliable",
      });
    }
  }

  private onUpdate(): void {
    this.expireBubbles();

    if (this.sp.storage["ownerModelSet"] !== true) return;
    const owner = this.sp.storage["ownerModel"] as Record<string, unknown> | undefined;
    if (!owner) return;

    const appearance = owner["appearance"] as { name?: string } | undefined;

    if (!this.mounted) {
      this.mounted = true;
      const name = appearance?.name || "You";
      const isAdmin = owner["isAdmin"] === true;
      logTrace(this, "Mounting chat widget (local parse + render)");
      this.sp.browser.executeJavaScript(buildMountJs(name, isAdmin));
      this.sp.browser.setVisible(true);
    }

    const liveName = appearance?.name;
    if (liveName && liveName !== this.lastName) {
      this.lastName = liveName;
      this.sp.browser.executeJavaScript(`window.__skyrpSetNames && window.__skyrpSetNames(${JSON.stringify(liveName)});`);
    }

    const msg = owner[CHAT_MSG_PROP];
    if (typeof msg === "string" && msg !== "" && msg !== this.lastMsg) {
      this.lastMsg = msg;
      const dist = this.senderDistanceMeters(msg);
      this.sp.browser.executeJavaScript(`window.__skyrpAddChat && window.__skyrpAddChat(${JSON.stringify(msg)}, ${dist});`);
    }
  }

  private senderDistanceMeters(raw: string): number {
    try {
      let s = raw;
      const us = s.indexOf("\u001f");
      if (us > 0 && /^[0-9]+$/.test(s.slice(0, us))) s = s.slice(us + 1);
      if (s.indexOf("[[B") !== 0) return -1;
      const be = s.indexOf("]]");
      const hex = be > 3 ? s.slice(3, be) : "";
      if (!/^[0-9a-fA-F]+$/.test(hex)) return -1;
      const refId = parseInt(hex, 16);
      if (!refId) return -1;
      const sender = this.sp.ObjectReference.from(this.sp.Game.getFormEx(refId));
      const player = this.sp.Game.getPlayer();
      if (!sender || !player) return -1;
      const dx = sender.getPositionX() - player.getPositionX();
      const dy = sender.getPositionY() - player.getPositionY();
      const dz = sender.getPositionZ() - player.getPositionZ();
      const meters = Math.sqrt(dx * dx + dy * dy + dz * dz) / UNITS_PER_METER;
      return Math.round(meters * 100) / 100;
    } catch (e) {
      return -1;
    }
  }

  // Chat bubbles over the player's head for IC lines (/say /me /my ...).
  private showBubble(refrId: number, text: string): void {
    if (!text || !refrId) return;
    const id = this.sp.createText(-1000, -1000, text.slice(0, 100), [1, 1, 1, 1]);
    this.sp.setTextSize(id, 0.4);
    this.sp.setTextRefr(id, refrId);
    this.sp.setTextRefrNode(id, "NPC Head [Head]");
    this.sp.setTextRefrOffset(id, [0, 0, 40]);
    this.bubbles.push({ id, expiresAt: Date.now() + 6000 });
  }

  private expireBubbles(): void {
    const now = Date.now();
    this.bubbles = this.bubbles.filter((b) => {
      if (now < b.expiresAt) return true;
      this.sp.destroyText(b.id);
      return false;
    });
  }

  private mounted = false;
  private lastMsg: string | null = null;
  private lastName: string | null = null;
  private bubbles: { id: number; expiresAt: number }[] = [];
}
