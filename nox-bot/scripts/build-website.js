'use strict';

/**
 * Turns the exported NØX design (one big HTML file from ChatGPT) into the live site:
 *   - the embedded images become files in public/assets/ (the page drops from ~3.4 MB to ~0.4 MB and images are cached),
 *   - the demo-only API stub is swapped for real calls to this server (/api/nox/...). If the server can't be reached
 *     (e.g. the file is opened straight from disk) the page still falls back to the original offline preview,
 *   - no access fee: signing in with Discord is all it takes to buy (the texts say so too),
 *   - after paying, a receipt with the order, its Discord ticket and its delivery.
 *
 *   node scripts/build-website.js path/to/NOX_website.html
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/build-website.js path/to/NOX_website.html');
  process.exit(1);
}
const OUT = path.join(__dirname, '..', 'web', 'public');
let html = fs.readFileSync(src, 'utf8');

// 1. Images → files (same image = same file)
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const names = new Map();
html = html.replace(/data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)/g, (all, type, b64) => {
  const ext = EXT[type];
  if (!ext || b64.length < 4096) return all; // tiny icons stay inline
  const hash = crypto.createHash('sha1').update(b64).digest('hex').slice(0, 10);
  if (!names.has(hash)) {
    const file = `img-${hash}.${ext}`;
    fs.writeFileSync(path.join(OUT, 'assets', file), Buffer.from(b64, 'base64'));
    names.set(hash, file);
  }
  return `/assets/${names.get(hash)}`;
});

// 2. The demo API stub → real requests to the server
const STUB = /async function de\(a,e\)\{if\(a==="store"\)return\{products:Kc,[\s\S]*?require the connected server\."\)\}/;
if (!STUB.test(html)) {
  console.error('Could not find the demo API function in the HTML – was the design exported again with changes?');
  process.exit(1);
}
const OFFLINE = '{products:Kc,preview:!0,authReady:!1,paymentsReady:!1,accessPrice:null,discordUrl:null}';
const LIVE =
  'async function de(a,e){' +
  'const o=e===void 0?{credentials:"same-origin",headers:{accept:"application/json"}}' +
  ':{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(e)};' +
  'let r;try{r=await fetch("/api/nox/"+a,o)}catch(x){' +
  `if(a==="store")return ${OFFLINE};if(a==="session")return{user:null,access:!1};if(a==="logout")return{ok:!0};` +
  'throw new Error("The N\\xD8X server can\'t be reached right now. Please try again in a moment.")}' +
  `if(r.status===404&&a==="store")return ${OFFLINE};` +
  'let j={};try{j=await r.json()}catch(x){}' +
  'if(!r.ok)throw new Error(j.error||"Something went wrong. Please try again.");return j}';
html = html.replace(STUB, LIVE);

// 3. Coming back from Discord with an error: say what happened instead of the demo text.
html = html.replace(
  'Ue("Discord sign-in is not connected yet. You can explore the demo.")',
  'Ue(b.get("auth")==="failed"?"Discord sign-in didn\'t work. Please try again.":b.get("auth")==="cancelled"?"Discord sign-in was cancelled.":"Discord sign-in is not connected yet. You can explore the demo.")',
);

// 4. Products with their own picture (set with /product add | edit image) show it on their card.
html = html.replace(/a\.art==="games"\?\(0,d\.jsx\)\("div",\{className:"art game-art",children:\(0,d\.jsx\)\("img",\{src:"([^"]+)"/, (all, src) =>
  `a.art==="games"||a.image?(0,d.jsx)("div",{className:"art game-art",children:(0,d.jsx)("img",{src:a.image||"${src}"`,
);

// 5. crypto.randomUUID only exists on https (or localhost) – on a plain http://IP:port the checkout button failed with
// "crypto.randomUUID is not a function". getRandomValues works everywhere, so the page gets its own.
const UUID = '<script>if(window.crypto&&!crypto.randomUUID){crypto.randomUUID=function(){var b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;var h=Array.prototype.map.call(b,function(x){return(x+256).toString(16).slice(1)}).join("");return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}}</script>';
html = html.replace(/<head>/i, (h) => `${h}${UUID}`);

/** Swaps one piece of the design – it must be there exactly once (a changed export fails loudly instead of half-patched). */
function swap(from, to) {
  const n = html.split(from).length - 1;
  if (n !== 1) {
    console.error(`Expected exactly one "${from.slice(0, 90)}" in the HTML, found ${n} – was the design exported again with changes?`);
    process.exit(1);
  }
  html = html.replace(from, () => to);
}

// 7. No access fee: signing in with Discord is all it takes to buy (the bot adds the buyer to the server with the Member
// role). The bag works before signing in and survives the trip to Discord (sessionStorage); checkout asks to sign in.
const R = String.raw;
swap('content="The complete NØX store design with an offline member and purchase demo."', 'content="NØX – games, Discord bots and Discord servers. Sign in with Discord, pay securely by card and get your order on Discord."');
html = html.replace(/var s7=\[\["How does N\\xD8X access work\?"[\s\S]*?\]\];/, () =>
  R`var s7=[["How do I buy?","Sign in with Discord – that’s all. There is no membership or access fee: fill your bag, pay securely by card with Stripe and your order opens in a private ticket on the N\xD8X Discord."],["Do I have to join the N\xD8X Discord first?","No. When you sign in, we add you to the N\xD8X server automatically and give you the Member role – your orders and support are always one click away."],["How fast is delivery?","Products with instant delivery arrive the moment your payment is confirmed – in your ticket and in your Discord DMs. Everything else is delivered by the N\xD8X team in your ticket."],["What happens if I change my Discord name?","Your orders are linked to your unique Discord ID. Changing your display name will not change that ID. Always sign in with the same account."],["Where do I find my purchases?","Open My orders after signing in. Every order shows its status, its delivery and a direct link to its Discord ticket."]];`,
);
if (!html.includes('["How do I buy?"')) {
  console.error('Could not find the FAQ in the HTML.');
  process.exit(1);
}
const COPY = [
  [R`ia?"Explore your collection":"Unlock N\xD8X"`, R`ia?"Explore the collection":"Sign in with Discord"`],
  [R`"aria-label":"N\xD8X access pass illustration"`, R`"aria-label":"N\xD8X member card illustration"`],
  [R`children:["ACCESS",(0,d.jsx)("br",{}),"PASS"]`, R`children:["MEMBER",(0,d.jsx)("br",{}),"CARD"]`],
  [R`children:"Payment-confirmed access"`, R`children:"Secure checkout"`],
  [R`children:"Unlock once. Shop your way."`, R`children:"Card payments by Stripe"`],
  [R`fa?"Demo access":ia?"Your access is active":"Member access required"`, R`fa?"Demo account":ia?"Signed in – ready to shop":"Sign in with Discord to buy"`],
  [R`children:[ia?(0,d.jsx)(mt,{size:15}):(0,d.jsx)(le,{size:14})," ",ia?"Add to bag":"Unlock"]`, R`children:[(0,d.jsx)(mt,{size:15})," Add to bag"]`],
  [R`function jc(b){if(!ia){r("access");return}o(`, R`function jc(b){o(`],
  [R`children:[(0,d.jsx)(le,{size:11}),"Your next upgrade is one unlock away."]`, R`children:[(0,d.jsx)(Ut,{size:11}),"Secure checkout by Stripe \xB7 delivered on Discord"]`],
  [R`"Connect the account you already use. Activate your access. Make the collection yours."`, R`"Sign in with the Discord account you already use. Pick what you like, pay securely and get it delivered right on Discord."`],
  [R`ia?"View your access":"Get your N\xD8X access"`, R`ia?"View your account":"Sign in with Discord"`],
  [R`"One-time access fee. Products purchased separately."`, R`"No membership. No access fee. You only pay for what you buy."`],
  [R`title:"Make the connection.",text:"Sign in with Discord. Your unique ID keeps everything linked to you."`, R`title:"Sign in with Discord.",text:"One click. You’re added to the N\xD8X server with the Member role automatically."`],
  [R`{icon:(0,d.jsx)(le,{size:22}),title:"Unlock your access.",text:"Purchase a one-time access pass. The store unlocks after payment confirmation."}`, R`{icon:(0,d.jsx)(zt,{size:22}),title:"Fill your bag.",text:"Games, bots and servers. Pay securely by card – Stripe handles the payment."}`],
  [R`{icon:(0,d.jsx)(zt,{size:22}),title:"Find your next upgrade.",text:"Shop the full collection and follow every purchase from your account."}`, R`{icon:(0,d.jsx)(Dl,{size:22}),title:"Get it on Discord.",text:"Your order opens in a private ticket. Instant products arrive right away – in the ticket and your DMs."}`],
  [R`"N\xD8X ACCESS"]`, R`"N\xD8X ACCOUNT"]`],
  [R`children:"YOUR KEY TO THE COLLECTION"`, R`children:"SIGN IN TO SHOP"`],
  [R`"Your Discord account brings your access and every purchase together."`, R`"One Discord account for every order – and a place on the N\xD8X server with the Member role."`],
  [R`"Activate access"]`, R`"Start shopping"]`],
  [R`fa?"Demo access is active.":"Your N\xD8X access is active."`, R`fa?"Demo account is ready.":t.member?"You’re signed in and a Member of the N\xD8X Discord.":"You’re signed in and ready to shop."`],
  [R`"Only your public Discord identity is requested."`, R`"We only use your Discord name and avatar, and add you to the N\xD8X server. Nothing is ever posted for you."`],
  [R`"This standalone HTML includes the complete store demo. Real Discord sign-in and payments require the connected server."`, R`"Discord sign-in isn’t switched on yet. You can explore the store in the meantime."`],
  [R`function Nc(){u(1),o({}),r("access")}`, R`function Nc(){u(2),o({}),r("access")}`],
  [R`"Linked to your account"`, R`"Linked to your Discord account"`],
  [R`"Order history in one place"`, R`"Delivered in your private Discord ticket"`],
  [R`"Support through N\xD8X"`, R`"Real support from the N\xD8X team"`],
  [R`children:[ia?(0,d.jsx)(zt,{size:16}):(0,d.jsx)(le,{size:16})," ",ia?"Add to bag":"Unlock access"]`, R`children:[(0,d.jsx)(zt,{size:16})," Add to bag"]`],
  [R`children:[(0,d.jsx)(le,{size:16}),fa?"Create a demo order":"Continue to checkout",(0,d.jsx)(Le,{size:17})]`, R`children:[ia?(0,d.jsx)(le,{size:16}):(0,d.jsx)(Ma,{size:17}),fa?"Create a demo order":ia?"Continue to checkout":"Sign in with Discord to check out",(0,d.jsx)(Le,{size:17})]`],
  [R`"The total is confirmed before payment on Stripe."`, R`"Secure card payment by Stripe. Your order opens on Discord right after."`],
  [R`"Questions about a product, your access or an order? The N\xD8X team can help through Discord."`, R`"Questions about a product or an order? The N\xD8X team is on Discord and happy to help."`],
  [R`children:"Access and products"`, R`children:"Buying"`],
  [R`"The one-time access fee unlocks the ability to shop. Each product is purchased separately."`, R`"Sign in with Discord and you can buy right away – there is no membership or access fee. You only pay for the products in your bag."`],
  [R`"Your unique Discord ID links your access and orders. Your public name and avatar are used for your profile."`, R`"Your unique Discord ID links your orders. Your public name and avatar are used for your profile, and you’re added to the N\xD8X Discord with the Member role."`],
  [R`"Access is granted after payment verification. Track purchases in My orders and contact N\xD8X for delivery support."`, R`"Card payments are handled by Stripe – N\xD8X never sees your card details. After payment your order opens in a private ticket on Discord, and products with instant delivery arrive there and in your DMs right away."`],
  [R`Ue("Checkout cancelled. No access was activated.")`, R`Ue("Checkout cancelled – you haven’t been charged.")`],
  [R`b.has("connected")&&r("access")`, R`b.has("connected")&&(r(Object.values(H).some(Boolean)?"cart":"access"),b.get("joined")==="1"&&Ue("Welcome to N\xD8X! You’ve been added to our Discord with the Member role."))`],
  [R`[H,o]=(0,B.useState)({})`, R`[H,o]=(0,B.useState)(()=>{try{return JSON.parse(sessionStorage.getItem("nox-bag")||"{}")||{}}catch(x){return{}}})`],
  [R`(0,B.useEffect)(()=>{Ml.current=""},[H])`, R`(0,B.useEffect)(()=>{Ml.current="";try{sessionStorage.setItem("nox-bag",JSON.stringify(H))}catch(x){}},[H])`],
  // My orders: the full reference, a clear status, the delivery note and a link to the ticket.
  [R`children:["#",b.id.slice(0,12)]`, R`children:[b.id]`],
  [R`(0,d.jsx)("b",{children:b.status==="demo"?"DEMO COMPLETE":b.status.toUpperCase()})`, R`(0,d.jsx)("b",{className:"st-"+b.status,children:b.status==="demo"?"DEMO COMPLETE":b.status==="paid"?b.delivered?"DELIVERED":"PAID":b.status==="pending"?"AWAITING PAYMENT":b.status==="failed"?"NOT COMPLETED":b.status.toUpperCase()})`],
  [R`(0,d.jsx)("p",{className:"fineprint",children:b.delivery||"Payment confirmed. Delivery is being prepared. Contact N\xD8X with your order reference."})`, R`(0,d.jsx)("p",{className:"order-delivery",children:b.delivery||"Payment confirmed. Delivery is being prepared. Contact N\xD8X with your order reference."}),b.status==="paid"&&b.ticketUrl&&(0,d.jsxs)("a",{className:"button secondary full",href:b.ticketUrl,target:"_blank",rel:"noreferrer",children:[(0,d.jsx)(Ma,{size:16}),"Open ticket #"+b.ticketNumber,(0,d.jsx)(xa,{size:14})]})`],
];
for (const [from, to] of COPY) swap(from, to);

// 8. After paying: a receipt instead of a toast – payment confirmed, what was bought, the order reference, the Discord
// ticket (with a link straight to it) and whether it's delivered already. Keeps checking while Stripe or the ticket is
// still on its way.
const RECEIPT = R`function NxReceipt({s,user,discord,onShop,onOrders,onRetry,onBag,onSupport}){if(!s)return null;const j=d.jsx,J=d.jsxs;
if(s.state==="checking")return J("div",{className:"modal-content receipt",children:[j("div",{className:"receipt-badge wait",children:j(Re,{className:"spin",size:30})}),j("div",{className:"eyebrow",children:"ALMOST THERE"}),j("h2",{children:"Confirming your payment…"}),j("p",{children:"Stripe is confirming your payment and your order is being prepared on Discord. This only takes a moment – please keep this page open."})]});
if(s.state==="error"||s.state==="failed"){const f=s.state==="failed";return J("div",{className:"modal-content receipt",children:[j("div",{className:"receipt-badge bad",children:j(bt,{size:30})}),j("div",{className:"eyebrow",children:f?"PAYMENT NOT COMPLETED":"SOMETHING WENT WRONG"}),j("h2",{children:f?"This payment didn’t go through.":"We couldn’t check your payment."}),j("p",{children:f?"No money was taken. Your bag is still here – try again whenever you’re ready.":(s.error||"Please try again in a moment.")+" If you were charged, contact N\xD8X – we’ll sort it out."}),J("div",{className:"receipt-actions",children:[f?J("button",{className:"button primary",onClick:onBag,children:[j(zt,{size:16}),"Back to your bag"]}):J("button",{className:"button primary",disabled:s.busy,onClick:onRetry,children:[s.busy?j(Re,{className:"spin",size:16}):j(Le,{size:16}),"Check again"]}),J("button",{className:"button secondary",onClick:onSupport,children:[j(Rl,{size:16}),"Contact support"]})]})]})}
if(s.state==="pending")return J("div",{className:"modal-content receipt",children:[j("div",{className:"receipt-badge wait",children:j(Re,{size:30})}),j("div",{className:"eyebrow",children:"PAYMENT PROCESSING"}),j("h2",{children:"Your payment is on its way."}),j("p",{children:"Stripe hasn’t confirmed it yet – with some payment methods that takes a few minutes. Your order opens on Discord automatically as soon as it’s confirmed."}),J("div",{className:"receipt-actions",children:[J("button",{className:"button primary",disabled:s.busy,onClick:onRetry,children:[s.busy?j(Re,{className:"spin",size:16}):j(Le,{size:16}),"Check again"]}),J("button",{className:"button secondary",onClick:onOrders,children:[j(Dl,{size:16}),"My orders"]})]})]});
const o=s.order,ticket=!!(o&&o.ticketUrl),waiting=!!(o&&o.waiting),done=!!(o&&o.delivered),first=user&&user.name?", "+String(user.name).split(" ")[0]:"";
return J("div",{className:"modal-content receipt",children:[j("div",{className:"receipt-badge ok",children:j(te,{size:36,strokeWidth:2.4})}),j("div",{className:"eyebrow",children:"PAYMENT CONFIRMED"}),j("h2",{children:"Thank you"+first+"."}),
j("p",{children:done?"Your order is complete and already delivered – it’s waiting in your Discord ticket and your DMs.":ticket?"Your order is confirmed and waiting for you in a private ticket on the N\xD8X Discord.":waiting?"Your order is confirmed. Join the N\xD8X Discord with this account and it opens there automatically.":"Your order is confirmed. We’re opening your private ticket on Discord…"}),
o&&J("div",{className:"receipt-card",children:[J("div",{className:"receipt-head",children:[J("div",{children:[j("small",{children:"ORDER"}),j("b",{children:o.id})]}),J("div",{children:[j("small",{children:"DATE"}),j("b",{children:new Date(o.created*1e3).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})})]})]}),
j("div",{className:"receipt-items",children:o.items.map((x,i)=>J("div",{className:"receipt-item",children:[J("span",{children:[j("em",{children:x.quantity+"\xD7"}),x.name]}),j("b",{children:At(x.price*x.quantity)})]},i))}),
J("div",{className:"receipt-total",children:[j("span",{children:"Total paid"}),j("b",{children:At(o.amount)})]}),J("div",{className:"receipt-meta",children:[j(Ut,{size:13}),"Paid by card \xB7 secured by Stripe"]})]}),
J("ol",{className:"receipt-steps",children:[J("li",{className:"done",children:[j("i",{children:j(te,{size:12})}),J("div",{children:[j("b",{children:"Payment received"}),j("small",{children:"Confirmed by Stripe"})]})]}),
J("li",{className:ticket?"done":"current",children:[j("i",{children:ticket?j(te,{size:12}):j(Ma,{size:12})}),J("div",{children:[j("b",{children:ticket?"Ticket #"+o.ticketNumber+" opened":waiting?"Join the N\xD8X Discord":"Opening your ticket"}),j("small",{children:ticket?"Your private channel on the N\xD8X Discord":waiting?"Your ticket opens as soon as you join":"This takes a few seconds"})]})]}),
J("li",{className:done?"done":ticket?"current":"",children:[j("i",{children:done?j(te,{size:12}):j(Dl,{size:12})}),J("div",{children:[j("b",{children:done?"Delivered":"Delivery"}),j("small",{children:done?"In your ticket and your Discord DMs":"A seller delivers it in your ticket"})]})]})]}),
ticket?J("a",{className:"button primary full",href:o.ticketUrl,target:"_blank",rel:"noreferrer",children:[j(Ma,{size:18}),"Open ticket #"+o.ticketNumber,j(xa,{size:16})]}):waiting&&discord?J("a",{className:"button primary full",href:discord,target:"_blank",rel:"noreferrer",children:[j(Ma,{size:18}),"Join the N\xD8X Discord",j(xa,{size:16})]}):null,
J("div",{className:"receipt-actions",children:[J("button",{className:"button secondary",onClick:onShop,children:[j(zt,{size:15}),"Continue shopping"]}),J("button",{className:"button secondary",onClick:onOrders,children:[j(Dl,{size:15}),"My orders"]})]}),
j("p",{className:"fineprint",children:o?"Keep your order reference "+o.id+" – you’ll also find it in My orders.":"You’ll find this order in My orders."})]})}`.replace(/\n/g, '');
const VERIFY = R`function nxGo(sid,n){n||(r("paid"),nxS({state:"checking",sid}));de("verify",{sessionId:sid}).then(async T=>{let os=(await de("orders")).orders;p(os),l(await de("session"));let ord=os.find(x=>x.stripe_id===sid)||null;if(T.paid){o({}),nxS({state:"paid",sid,order:ord}),ord&&!ord.ticketUrl&&!ord.waiting&&n<6&&setTimeout(()=>nxGo(sid,n+1),2e3)}else T.status==="pending"&&n<5?setTimeout(()=>nxGo(sid,n+1),2e3):nxS({state:T.status==="pending"?"pending":"failed",sid,order:ord})}).catch(T=>nxS({state:"error",sid,error:T.message}))}`;
swap('function Vc(){', `${RECEIPT}function Vc(){`);
swap(R`[Hn,au]=(0,B.useState)(!1),`, R`[Hn,au]=(0,B.useState)(!1),[nxR,nxS]=(0,B.useState)(null),`);
swap(R`function Xc(b){i(b),r("product")}`, R`function Xc(b){i(b),r("product")}` + VERIFY);
swap(
  R`b.get("payment")==="return"&&b.get("session_id")&&(r("orders"),K(!0),de("verify",{sessionId:b.get("session_id")}).then(async T=>{l(await de("session")),p((await de("orders")).orders),Ue(T.paid?"Payment confirmed. Your account is updated.":"Payment is awaiting confirmation.")}).catch(T=>ya(T.message)).finally(()=>K(!1)))`,
  R`b.get("payment")==="return"&&b.get("session_id")&&nxGo(b.get("session_id"),0)`,
);
swap(R`(n==="product"?" product-modal":"")`, R`(n==="product"?" product-modal":"")+(n==="paid"?" receipt-modal":"")`);
swap(
  R`J&&(0,d.jsx)("div",{className:"error",role:"alert",children:J})`,
  R`n==="paid"&&(0,d.jsx)(NxReceipt,{s:nxR,user:t.user,discord:a.discordUrl,onShop:tu,onOrders:Cc,onBag:()=>r("cart"),onSupport:()=>r("support"),onRetry:()=>{nxS({...nxR,busy:!0}),nxGo(nxR.sid,5)}}),J&&(0,d.jsx)("div",{className:"error",role:"alert",children:J})`,
);

// 9. Layout fixes and the new pieces' styles, on top of the design's own CSS.
const FIXES = `
/* Phones: the hero picture sat on top of the buttons once the title wrapped to three lines – now it follows them. */
@media (max-width:650px){
  .hero{min-height:0;padding-bottom:64px}
  .hero-visual{position:relative;top:auto;left:50%;margin:6px 0 -176px -285px;transform-origin:50% 0}
  .tabs{overflow-x:auto;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}
  .tabs::-webkit-scrollbar{display:none}
}
/* The receipt after paying */
.receipt-modal{width:min(540px,100% - 32px)}
.receipt{text-align:center;padding:46px 34px 30px}
.receipt>.eyebrow{justify-content:center;letter-spacing:2.4px;font-size:9px}
.receipt h2{margin:12px 0 10px}
.receipt>p{max-width:410px;margin:0 auto}
.receipt-badge{position:relative;width:80px;height:80px;margin:0 auto 22px;border-radius:50%;display:grid;place-items:center}
.receipt-badge.ok{color:#d3f7e3;background:radial-gradient(circle at 50% 35%,#4fae8266,#1d4a3622 72%);border:1px solid #7fd0a666;box-shadow:0 0 0 8px #78b19412,0 0 70px #4fae8245;animation:nx-pop .55s cubic-bezier(.2,1.4,.4,1) both}
.receipt-badge.ok:after{content:"";position:absolute;inset:-10px;border-radius:50%;border:1px solid #7fd0a640;animation:nx-ring 1.8s ease-out .25s both}
.receipt-badge.wait{color:#d4adf0;background:#a855f71c;border:1px solid #b77fe24d;box-shadow:0 0 55px #a855f72e}
.receipt-badge.bad{color:#f1b4c2;background:#b673801c;border:1px solid #c184944d}
@keyframes nx-pop{0%{transform:scale(.55);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes nx-ring{0%{transform:scale(.8);opacity:1}to{transform:scale(1.3);opacity:0}}
.receipt-card{text-align:left;margin:26px 0 0;background:linear-gradient(180deg,#1e1428,#170f1f);border:1px solid #bb83d130;border-radius:12px;overflow:hidden;box-shadow:0 18px 50px #0006}
.receipt-head{display:flex;justify-content:space-between;gap:16px;padding:16px 18px;border-bottom:1px dashed #b188c433}
.receipt-head small{display:block;color:#8d6a9e;font-size:8px;letter-spacing:1.8px;margin-bottom:6px}
.receipt-head b{font:500 12px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#ead3f8;letter-spacing:.5px}
.receipt-head>div:last-child{text-align:right}
.receipt-items{padding:4px 18px}
.receipt-item{display:flex;justify-content:space-between;gap:18px;padding:11px 0;font-size:12px;color:#dcc4ea;border-bottom:1px solid #b188c414}
.receipt-item:last-child{border-bottom:0}
.receipt-item span{display:flex;gap:10px;min-width:0;line-height:1.5}
.receipt-item em{font-style:normal;color:#a77fc0;font-variant-numeric:tabular-nums}
.receipt-item b{font-weight:500;white-space:nowrap;font-variant-numeric:tabular-nums}
.receipt-total{display:flex;justify-content:space-between;align-items:baseline;padding:15px 18px;background:#a855f70f;border-top:1px solid #b188c42c;color:#c7a6da;font-size:12px}
.receipt-total b{font-size:23px;font-weight:600;color:#fff;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
.receipt-meta{display:flex;align-items:center;gap:7px;padding:10px 18px;font-size:9.5px;letter-spacing:.2px;color:#8fc4a8;border-top:1px solid #b188c414}
.receipt-steps{list-style:none;margin:22px 0 4px;padding:0;text-align:left}
.receipt-steps li{position:relative;display:flex;gap:13px;padding:0 0 17px}
.receipt-steps li:not(:last-child):before{content:"";position:absolute;left:13px;top:29px;bottom:3px;width:1px;background:#b188c42e}
.receipt-steps li.done:not(:last-child):before{background:#78b19470}
.receipt-steps i{flex:none;width:27px;height:27px;border-radius:50%;display:grid;place-items:center;color:#7a598d;border:1px solid #734d875e;background:#13101a}
.receipt-steps .done i{color:#d3f7e3;background:#4fae8236;border-color:#7fd0a660}
.receipt-steps .current i{color:#e8ccfa;background:#a855f72e;border-color:#b77fe2;box-shadow:0 0 0 4px #a855f716;animation:nx-glow 1.6s ease-in-out infinite}
@keyframes nx-glow{50%{box-shadow:0 0 0 7px #a855f70a}}
.receipt-steps b{display:block;font-size:12.5px;font-weight:550;color:#eedcf9;padding-top:2px}
.receipt-steps li:not(.done):not(.current) b{color:#9a7cab}
.receipt-steps small{display:block;margin-top:3px;font-size:10.5px;color:#9a78ab}
.receipt-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:11px}
.receipt-actions .button{width:100%;padding:0 12px}
@media (max-width:480px){.receipt{padding:42px 20px 24px}.receipt-actions{grid-template-columns:1fr}}
/* My orders */
.order-top>span{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.4px}
.order-top>b.st-paid{color:#9fd8b9;background:#78b19420}
.order-top>b.st-pending{color:#e8c690;background:#d1a35a1e}
.order-top>b.st-expired,.order-top>b.st-failed{color:#e7a1b3;background:#b673801e}
.order-delivery{margin:13px 0 0;padding:10px 12px;border-radius:6px;background:#a855f70d;border:1px solid #b278d324;color:#c3a5d4;font-size:10.5px;line-height:1.65}`;
html = html.replace('</head>', `<style id="nox-fixes">${FIXES}</style></head>`);

fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`web/public/index.html – ${(html.length / 1024).toFixed(0)} KB, ${names.size} images in web/public/assets/`);
