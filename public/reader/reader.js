const DATABASE = 'foundry-translate-light-reader-v1';
const STORE = 'libraries';
const $ = id => document.getElementById(id);
const surface = $('reading-surface');
const prose = $('prose');
const panel = $('panel');
const words = {
  cs: { foundry:'Otevřít Foundry', library:'Knihovna', contents:'Obsah', bookmarks:'Záložky', bookmark:'Přidat záložku', bookmarked:'Odebrat záložku', find:'Hledat na stránce', settings:'Nastavení čtení', back:'Zpět', previous:'Předchozí', next:'Další', local:'Místní knihovna', close:'Zavřít', reader:'Místní čtečka', choose:'Vyberte místní knihovnu', empty:'V tomto profilu prohlížeče zatím není připravená žádná knihovna. Připravte ji ve Foundry přes nabídku čtečky.', unavailable:'Tato knihovna v tomto profilu prohlížeče není dostupná. Vyberte ji z knihovny nebo ji znovu připravte ve Foundry.', missing:'Tento dokument není součástí místní knihovny. Připravte příslušnou knihu ve Foundry a aktualizujte knihovnu.', privacy:'Kopie je soukromá pro tento profil prohlížeče a může obsahovat texty Vypravěče. Odhlášení ani odebrání přístupu ve Foundry uloženou kopii nesmaže.', update:'Knihovnu aktualizujete ve Foundry. Zde se čte její uložená kopie; obrázky mohou vyžadovat připojení.', theme:'Vzhled', dark:'Tmavý', paper:'Světlý', sepia:'Sépie', font:'Velikost písma', fullscreen:'Celá obrazovka', remove:'Odstranit tuto knihovnu', confirmRemove:'Odstranit tuto místní knihovnu i její záložky a uloženou pozici? Ostatní knihovny zůstanou zachované.', removed:'Místní knihovna odstraněna.', saved:'Záložka uložena.', unsaved:'Záložka odebrána.', noBookmarks:'V této knihovně zatím nemáte záložky.', readaloud:'Číst nahlas', failure:'Místní knihovnu se nepodařilo načíst. Přístup k úložišti může být v tomto prohlížeči omezen.', storage:'Pozici nelze uložit do místního úložiště.', noMatches:'Bez shody', previousMatch:'Předchozí výskyt', nextMatch:'Další výskyt', warnings:'Poznámky knihovny', created:'Připraveno', selected:'Vybraná knihovna', noPages:'Knihovna neobsahuje čitelný dokument.', searchContents:'Hledat v obsahu', noContents:'V obsahu není shoda.', anchorMissing:'Cílový oddíl není v místní kopii dostupný.', unavailableFullscreen:'Celá obrazovka není v tomto prohlížeči dostupná.' },
  en: { foundry:'Open Foundry', library:'Library', contents:'Contents', bookmarks:'Bookmarks', bookmark:'Add bookmark', bookmarked:'Remove bookmark', find:'Find on page', settings:'Reading settings', back:'Back', previous:'Previous', next:'Next', local:'Local library', close:'Close', reader:'Local reader', choose:'Choose a local library', empty:'No library has been prepared in this browser profile. Prepare one using the reader menu in Foundry.', unavailable:'This library is unavailable in this browser profile. Choose a library or prepare it again in Foundry.', missing:'This document is not part of the local library. Prepare the relevant book in Foundry and update the library.', privacy:'This private browser-profile copy may contain GM text. Signing out or revoking Foundry access does not delete the saved copy.', update:'Update the library in Foundry. This reader uses a saved copy; images may require a connection.', theme:'Theme', dark:'Dark', paper:'Light', sepia:'Sepia', font:'Text size', fullscreen:'Fullscreen', remove:'Delete this library', confirmRemove:'Delete this local library, its bookmarks and reading position? Other libraries will be kept.', removed:'Local library deleted.', saved:'Bookmark saved.', unsaved:'Bookmark removed.', noBookmarks:'No bookmarks in this library yet.', readaloud:'Read aloud', failure:'Could not load the local library. Storage access may be restricted in this browser.', storage:'The reading position could not be saved locally.', noMatches:'No matches', previousMatch:'Previous match', nextMatch:'Next match', warnings:'Library notes', created:'Prepared', selected:'Selected library', noPages:'This library contains no readable documents.', searchContents:'Search contents', noContents:'No matching contents.', anchorMissing:'The target section is unavailable in this local copy.', unavailableFullscreen:'Fullscreen is unavailable in this browser.' }
};
let library = null, current = null, lookup = new Map(), state = {}, lang = 'cs', navigationIndex = 0;
let findMatches = [], findIndex = -1, noticeTimer, scrollTimer, lastPanelFocus, loadGeneration = 0, panelGeneration = 0;
const t = key => words[lang][key] || words.cs[key] || key;
const keyFor = id => `foundry-translate-light-reader:${id}`;
const key = () => keyFor(library.id);
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = String(value ?? ''); if (className) node.className = className; return node; };
function notify(message) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').hidden = false; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500); }
function button(label, action) { const node = text('button',label); node.type='button'; node.addEventListener('click',action); return node; }
function translateShell() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent=t(node.dataset.i18n); });
  for (const [id,label] of [['library-button','library'],['contents-button','contents'],['find-button','find'],['settings-button','settings'],['panel-close','close'],['find-close','close'],['find-previous','previousMatch'],['find-next','nextMatch']]) { $(id).setAttribute('aria-label',t(label)); $(id).title=t(label); }
  $('find-input').placeholder=t('find'); $('reading-progress').setAttribute('aria-label',t('local')); $('local-label').title=t('privacy');
}
function db() {
  return new Promise((resolve,reject) => {
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=() => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE,{keyPath:'id'}); };
    request.onsuccess=() => resolve(request.result); request.onerror=() => reject(request.error); request.onblocked=() => reject(new Error('Storage blocked'));
  });
}
async function storage(method, argument) {
  const connection=await db();
  try { return await new Promise((resolve,reject) => {
    const transaction=connection.transaction(STORE, method==='delete'?'readwrite':'readonly');
    const request=transaction.objectStore(STORE)[method](argument); let result;
    request.onsuccess=() => { result=request.result; }; request.onerror=() => reject(request.error);
    transaction.oncomplete=() => resolve(result); transaction.onerror=() => reject(transaction.error); transaction.onabort=() => reject(transaction.error);
  }); } finally { connection.close(); }
}
function readState() {
  let saved={}; try { saved=JSON.parse(localStorage.getItem(key()) || '{}') || {}; } catch { /* A corrupt reading position must not prevent reading. */ }
  const positions=Object.create(null); for (const [uuid,position] of Object.entries(saved.positions || {})) if (typeof position==='number' && Number.isFinite(position) && position>=0) positions[uuid]=position;
  const bookmarks=Array.isArray(saved.bookmarks)?saved.bookmarks.filter(x => typeof x?.uuid==='string' && typeof x?.position==='number' && Number.isFinite(x.position) && x.position>=0).slice(0,200):[];
  state={uuid:typeof saved.uuid==='string'?saved.uuid:null,positions,bookmarks,font:Math.max(16,Math.min(30,Number(saved.font)||21)),theme:['dark','sepia','paper'].includes(saved.theme)?saved.theme:'dark'};
  applySettings();
}
function saveState() { if (!library) return; try { localStorage.setItem(key(),JSON.stringify(state)); } catch { /* Reading is still available when persistence is denied. */ } }
function rememberPosition() { if (!library || !current) return; state.positions[current.uuid]=surface.scrollTop; state.uuid=current.uuid; saveState(); if (history.state?.libraryId===library.id && history.state?.uuid===current.uuid) history.replaceState({...history.state,position:surface.scrollTop},'',location.href); }
function applySettings() { document.body.dataset.theme=state.theme || 'dark'; document.documentElement.style.setProperty('--font-size',`${state.font || 21}px`); }
const allowedTags=new Set('a abbr article aside b blockquote br caption code col colgroup dd details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 header hr i img kbd li mark ol p pre s section small span strong sub summary sup table tbody td tfoot th thead tr u ul'.split(' '));
const allowedClasses=new Set('ft-reader-portrait ft-reader-static-embed ft-reader-check is-checked ft-reader-readaloud ft-reader-section ft-reader-form ft-reader-fieldset block readaloud secret gamemaster actor qna question answer meta portrait divider wip lore hazard outcome attunement scene state rolltable content-link caption float-left float-right frame small inset flexrow flexcol'.split(' '));
const dangerousTags=new Set('script style iframe object embed form input button textarea select option link meta base svg math template noscript audio video source'.split(' '));
function safeUrl(value,image=false) {
  if (typeof value!=='string' || value.length>2_000_000) return null;
  if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  try { const url=new URL(value,location.href); return ['https:','http:'].includes(url.protocol) && (!image || url.origin===location.origin)?url.href:null; } catch { return null; }
}
function sanitize(html) {
  const result=document.createDocumentFragment(); if (typeof html!=='string' || html.length>12_000_000) return result;
  // A detached template is inert, including media: do not load URLs while parsing.
  const parsed=document.createElement('template'); parsed.innerHTML=html;
  function copy(source,parent) {
    if (source.nodeType===Node.TEXT_NODE) { parent.append(document.createTextNode(source.textContent)); return; }
    if (source.nodeType!==Node.ELEMENT_NODE) return;
    const tag=source.localName;
    if (source.classList.contains('ft-reader-readaloud-label')) return;
    if (dangerousTags.has(tag)) return;
    if (!allowedTags.has(tag)) { for (const child of source.childNodes) copy(child,parent); return; }
    const node=document.createElement(tag);
    for (const attr of ['title','id','lang','dir','aria-label','aria-hidden']) { const value=source.getAttribute(attr); if (value && value.length<1024) node.setAttribute(attr,value); }
    const classes=(source.getAttribute('class') || '').split(/\s+/).filter(x => allowedClasses.has(x) || /^ft-ember-[a-z0-9_-]{1,64}$/i.test(x)).slice(0,24); if (classes.length) node.className=classes.join(' ');
    if (tag==='a') {
      const uuid=source.getAttribute('data-reader-uuid');
      if (uuid && uuid.length<1024) {
        node.dataset.readerUuid=uuid;
        const url=new URL(location.href),version=url.searchParams.get('v'),separator=uuid.indexOf('#');
        url.search='';if(version)url.searchParams.set('v',version);url.searchParams.set('library',library.id);
        url.searchParams.set('uuid',separator<0?uuid:uuid.slice(0,separator));url.hash=separator<0?'':`#${encodeURIComponent(uuid.slice(separator+1))}`;
        node.href=url.href;
      }
      else { const href=source.getAttribute('href'); if (href?.startsWith('#')) node.setAttribute('href',href); else { const url=safeUrl(href); if (url) { node.href=url; node.target='_blank'; node.rel='noopener noreferrer'; } } }
    }
    if (tag==='img') { const src=safeUrl(source.getAttribute('src'),true); if (!src) return; node.src=src; node.alt=source.getAttribute('alt') || ''; node.loading='lazy'; node.decoding='async'; node.referrerPolicy='no-referrer'; for (const attr of ['width','height']) if (/^\d{1,4}$/.test(source.getAttribute(attr) || '')) node.setAttribute(attr,source.getAttribute(attr)); }
    if (['td','th'].includes(tag)) for (const attr of ['colspan','rowspan']) if (/^[1-9]\d?$/.test(source.getAttribute(attr) || '')) node.setAttribute(attr,source.getAttribute(attr));
    if (tag==='ol' && /^-?\d{1,5}$/.test(source.getAttribute('start') || '')) node.setAttribute('start',source.getAttribute('start'));
    if (node.classList.contains('ft-reader-check')) node.setAttribute('role','img');
    if (node.classList.contains('readaloud') && !source.parentElement?.closest('.readaloud')) node.dataset.readerCallout=t('readaloud');
    for (const child of source.childNodes) copy(child,node); parent.append(node);
  }
  for (const child of parsed.content.childNodes) copy(child,result); return result;
}
function resolve(uuid) { return lookup.get(uuid) || null; }
function chapterSequence() {
  if (!current) return [];
  const chapters=Array.isArray(current.chapters)?current.chapters:[];
  const ids=chapters.filter(chapter => typeof chapter?.uuid==='string').map(chapter => resolve(chapter.uuid)?.uuid || chapter.uuid);
  return [...new Set(ids.length?ids:library.documents.filter(doc => doc.book===current.book && doc.kind===current.kind).map(doc=>doc.uuid))];
}
function navigate(uuid,{anchor='',push=true,position=null,remember=true}={}) {
  const target=resolve(uuid); if (!target) { notify(t('missing')); return false; }
  if (remember) rememberPosition(); current=target; state.uuid=current.uuid; saveState();
  const url=new URL(location.href),version=url.searchParams.get('v'); url.search=''; if(version)url.searchParams.set('v',version); url.searchParams.set('library',library.id); url.searchParams.set('uuid',current.uuid); url.hash=anchor?`#${encodeURIComponent(anchor)}`:'';
  if (push) navigationIndex++;
  const requestedPosition=position ?? state.positions[current.uuid] ?? 0;
  const historyState={lightReader:true,libraryId:library.id,uuid:current.uuid,anchor,index:navigationIndex,position:requestedPosition};
  if (push) history.pushState(historyState,'',url); else history.replaceState(historyState,'',url);
  render();
  requestAnimationFrame(() => { if (anchor) jumpAnchor(anchor); else surface.scrollTop=requestedPosition; updateProgress(); });
  return true;
}
function render() {
  $('book-title').textContent=current.book || library.worldName || t('local'); $('page-title').textContent=current.title; $('article-title').textContent=current.title;
  $('article-context').textContent=[...new Set([library.worldName,current.book].filter(value=>typeof value==='string' && value))].join(' · ');
  const subtitle=[current.subtitle,current.pronunciation].filter(x => typeof x==='string' && x).join(' · '); $('article-subtitle').textContent=subtitle; $('article-subtitle').hidden=!subtitle;
  document.title=`${current.title} · ${t('reader')}`;
  prose.replaceChildren(sanitize(current.html)); clearFind(); if ($('find-input').value) runFind();
  const saved=state.bookmarks.some(bookmark => bookmark.uuid===current.uuid); $('bookmark-button').setAttribute('aria-pressed',String(saved)); $('bookmark-button').title=t(saved?'bookmarked':'bookmark'); $('bookmark-button').setAttribute('aria-label',t(saved?'bookmarked':'bookmark'));
  const sequence=chapterSequence(), index=sequence.indexOf(current.uuid); $('previous-page').disabled=index<=0; $('next-page').disabled=index<0 || index===sequence.length-1;
  $('back-button').disabled=navigationIndex<=0; $('page-navigation').hidden=sequence.length<2;
  for (const id of ['contents-button','bookmark-button','find-button','settings-button']) $(id).disabled=false;
}
function jumpAnchor(anchor) { let value=anchor; try { value=decodeURIComponent(anchor); } catch { /* Literal malformed anchor may still match. */ } const node=[...prose.querySelectorAll('[id]')].find(element=>element.id===value); if (node) { node.scrollIntoView({block:'start'}); } else { surface.scrollTop=0; notify(t('anchorMissing')); } }
function updateProgress() { const max=surface.scrollHeight-surface.clientHeight; const percent=max>0?Math.round(surface.scrollTop/max*100):100; $('reading-progress').value=Math.max(0,Math.min(100,percent)); $('position-label').textContent=current?`${Math.max(0,Math.min(100,percent))} %`:''; }
function openPanel(title) { panelGeneration++; if(!panel.open)lastPanelFocus=document.activeElement; $('panel-title').textContent=title; $('panel-body').replaceChildren(); if (!panel.open) panel.showModal(); else $('panel-close').focus(); }
function closePanel() { panel.close(); lastPanelFocus?.focus(); }
async function showLibraries() {
  openPanel(t('library')); const generation=panelGeneration; const body=$('panel-body'); body.append(text('p',t('privacy'),'panel-description'),foundryLink());
  if (library) { body.append(text('p',`${library.worldName || library.worldId} · ${library.userName || library.userId} · ${library.language}`,'panel-description')); body.append(text('p',t('update'),'panel-description')); const date=new Date(library.createdAt); if(Number.isFinite(date.getTime()))body.append(text('p',`${t('created')}: ${date.toLocaleString(lang)}`,'panel-description')); }
  try {
    // List keys only. Do not load another account's story HTML to build the chooser.
    const ids=await storage('getAllKeys'); if (!panel.open || generation!==panelGeneration) return;
    if (!ids.length) { body.append(text('p',t('empty'),'empty-state')); return; }
    const list=text('ul','','panel-list');
    for (const id of ids) {
      let metadata;try{metadata=JSON.parse(localStorage.getItem(`foundry-translate-light-reader-meta:${id}`)||'null');}catch{/* Optional metadata only. */}
      const labels=[metadata?.worldName,metadata?.userName,metadata?.language].filter(value=>typeof value==='string'&&value.length>0&&value.length<300);
      const item=text('li',''); const entry=button(labels.length?labels.join(' · '):String(id),async()=>{ closePanel(); await loadLibrary(String(id),null,{push:true}); }); if (id===library?.id) entry.setAttribute('aria-current','page'); item.append(entry); list.append(item);
    } body.append(list);
    if (library?.warnings?.length) { body.append(text('h3',t('warnings'),'panel-book')); const notes=text('ul',''); for (const warning of library.warnings.slice(0,100)) notes.append(text('li',warning)); body.append(notes); }
  } catch { if(panel.open && generation===panelGeneration)body.append(text('p',t('failure'),'empty-state')); }
}
function showContents(bookmarks=false) {
  if (!library) return showLibraries(); openPanel(t(bookmarks?'bookmarks':'contents')); const body=$('panel-body');
  const tabs=text('div','','panel-tabs'); for (const [label,value] of [['contents',false],['bookmarks',true]]) { const tab=button(t(label),()=>showContents(value)); tab.setAttribute('aria-pressed',String(value===bookmarks)); tabs.append(tab); } body.append(tabs);
  if (bookmarks) { const list=text('ul','','panel-list'); for (const saved of state.bookmarks) { const doc=resolve(saved.uuid); if (!doc) continue; const entry=button(doc.title,()=>{ closePanel(); navigate(doc.uuid,{position:saved.position}); }); const item=text('li',''); item.append(entry); list.append(item); } body.append(list.childElementCount?list:text('p',t('noBookmarks'),'empty-state')); return; }
  const input=document.createElement('input'); input.type='search'; input.placeholder=t('searchContents'); input.setAttribute('aria-label',t('searchContents')); input.style.width='100%'; body.append(input);
  const container=text('div',''); body.append(container);
  function fill() {
    container.replaceChildren(); let count=0;
    const books=new Map(); for (const doc of library.documents) { const group=doc.book || library.worldName || t('local'); if (!books.has(group)) books.set(group,new Map()); const entries=books.get(group); for (const chapter of Array.isArray(doc.chapters)?doc.chapters:[]) { if(typeof chapter?.uuid!=='string')continue; const canonical=resolve(chapter.uuid)?.uuid || chapter.uuid; if(!entries.has(canonical))entries.set(canonical,resolve(chapter.uuid) || {uuid:chapter.uuid,title:chapter.name || chapter.uuid,chapters:doc.chapters,unavailable:true}); } entries.set(doc.uuid,doc); }
    const query=input.value.toLocaleLowerCase(lang);
    for (const [book,entries] of books) {
      const filtered=[...entries.values()].filter(doc => `${doc.title} ${doc.subtitle || ''}`.toLocaleLowerCase(lang).includes(query)); if (!filtered.length) continue;
      container.append(text('h3',book,'panel-book')); const list=text('ul','','panel-list');
      for (const doc of filtered) { count++; const item=text('li',''); const entry=button(doc.title,()=>{ closePanel(); navigate(doc.uuid); }); if (doc.uuid===current?.uuid) entry.setAttribute('aria-current','page'); const chapter=doc.chapters?.find(x=>x.uuid===doc.uuid); if (chapter?.category || doc.unavailable) { const label=text('span',doc.title); label.append(text('small',doc.unavailable?(lang==='cs'?'Není v místní kopii':'Not in the local copy'):chapter.category)); entry.replaceChildren(label); } if(chapter && Number.isFinite(chapter.level))entry.style.paddingInlineStart=`${10+Math.min(5,Math.max(0,chapter.level))*12}px`; item.append(entry); list.append(item); } container.append(list);
    }
    if (!count) container.append(text('p',t('noContents'),'empty-state'));
  }
  input.addEventListener('input',fill); fill();
}
function foundryLink() {
  const path=location.pathname, boundary=path.lastIndexOf('/modules/');
  const prefix=boundary<0?'':path.slice(0,boundary);
  const link=text('a',t('foundry'),'foundry-link');link.href=new URL(`${prefix}/game`,location.origin).href;return link;
}
function showSettings() {
  if (!library) return showLibraries(); openPanel(t('settings')); const body=$('panel-body');
  const theme=text('div','','setting-row'), themeLabel=text('label',t('theme')); themeLabel.htmlFor='theme-select'; const select=document.createElement('select'); select.id='theme-select'; for (const value of ['dark','sepia','paper']) { const option=text('option',t(value)); option.value=value; select.append(option); } select.value=state.theme; select.addEventListener('change',()=>{ state.theme=select.value; applySettings(); saveState(); }); theme.append(themeLabel,select); body.append(theme);
  const font=text('div','','setting-row'); font.append(text('span',t('font'))); const controls=text('div','','font-controls'), value=text('output',`${state.font} px`); value.setAttribute('aria-live','polite'); const minus=button('A−',()=>resize(-1)),plus=button('A+',()=>resize(1)); minus.setAttribute('aria-label',lang==='cs'?'Zmenšit písmo':'Decrease text size'); plus.setAttribute('aria-label',lang==='cs'?'Zvětšit písmo':'Increase text size');
  function resize(delta) { rememberPosition(); state.font=Math.max(16,Math.min(30,state.font+delta)); value.textContent=`${state.font} px`; minus.disabled=state.font<=16; plus.disabled=state.font>=30; applySettings(); saveState(); updateProgress(); } controls.append(minus,value,plus);font.append(controls);body.append(font); minus.disabled=state.font<=16;plus.disabled=state.font>=30;
  body.append(button(t('fullscreen'),async()=>{ try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else notify(t('unavailableFullscreen')); } catch { notify(t('unavailableFullscreen')); } }));
  body.append(text('p',t('update'),'panel-description'),foundryLink(),text('p',t('privacy'),'panel-description'));
  const remove=button(t('remove'),async()=>{
    const selected=library; if (!selected || !confirm(t('confirmRemove'))) return;
    try { await storage('delete',selected.id); try { localStorage.removeItem(keyFor(selected.id)); localStorage.removeItem(`foundry-translate-light-reader-meta:${selected.id}`); } catch { /* IndexedDB removal succeeded. */ } if(library?.id!==selected.id){notify(t('removed'));return;} loadGeneration++; library=null;current=null;lookup.clear();state={};navigationIndex=0;closePanel();const url=new URL(location.href);url.search='';url.hash='';history.replaceState(null,'',url);emptyView(t('choose'));notify(t('removed'));await showLibraries(); } catch { notify(t('failure')); }
  }); remove.className='danger';body.append(remove);
}
function emptyView(message) {
  $('page-title').textContent=t('reader');$('book-title').textContent='Foundry Translate';$('article-title').textContent=t('choose');$('article-subtitle').hidden=true;$('article-context').textContent='';prose.replaceChildren(text('p',message,'empty-state'));$('page-navigation').hidden=true;current=null; $('back-button').disabled=true; for (const id of ['bookmark-button','find-button','settings-button']) $(id).disabled=true;updateProgress();
}
async function loadLibrary(id,uuid,{push=false,anchor=''}={}) {
  const generation=++loadGeneration; rememberPosition();
  try {
    const candidate=await storage('get',id); if(generation!==loadGeneration)return;
    if (!candidate || candidate.version!==1 || candidate.id!==id || !Array.isArray(candidate.documents)) { library=null;lookup.clear();emptyView(t('unavailable'));return showLibraries(); }
    library={...candidate,documents:candidate.documents.filter(doc => typeof doc?.uuid==='string' && typeof doc.title==='string' && typeof doc.html==='string').slice(0,5000).map(doc=>({...doc,book:typeof doc.book==='string'?doc.book:'',kind:typeof doc.kind==='string'?doc.kind:'',aliases:Array.isArray(doc.aliases)?doc.aliases.filter(value=>typeof value==='string'):[],chapters:Array.isArray(doc.chapters)?doc.chapters.filter(chapter=>typeof chapter?.uuid==='string').map(chapter=>({...chapter,name:typeof chapter.name==='string'?chapter.name:chapter.uuid,category:typeof chapter.category==='string'?chapter.category:''})):[]}))};
    lang=library.language?.toLowerCase().startsWith('en')?'en':'cs';translateShell();lookup=new Map();
    for (const doc of library.documents) { if (lookup.has(doc.uuid)) { lookup.set(doc.uuid,null); } else lookup.set(doc.uuid,doc); }
    // An ambiguous alias is never routed to an arbitrary document.
    for (const doc of library.documents) for (const alias of Array.isArray(doc.aliases)?doc.aliases:[]) { if (typeof alias!=='string' || !alias || alias===doc.uuid) continue; if (!lookup.has(alias)) lookup.set(alias,doc); else if (lookup.get(alias)?.uuid!==doc.uuid) lookup.set(alias,null); }
    readState(); current=null;
    const requested=uuid || (resolve(state.uuid)?state.uuid:library.startUuid); const target=resolve(requested);
    if (!target) { emptyView(uuid?t('missing'):t('noPages'));return showContents(); }
    navigationIndex=Math.max(0,Number(history.state?.index)||0);navigate(target.uuid,{anchor,push,position:push?null:history.state?.position ?? null,remember:false});
  } catch { if(generation!==loadGeneration)return; library=null;lookup.clear();emptyView(t('failure')); }
}
function clearFind() { for (const mark of prose.querySelectorAll('mark.reader-find-match')) mark.replaceWith(document.createTextNode(mark.textContent)); prose.normalize();findMatches=[];findIndex=-1;$('find-count').textContent=''; }
function runFind() {
  clearFind(); const query=$('find-input').value.toLocaleLowerCase(lang); if (!query) return;
  const walker=document.createTreeWalker(prose,NodeFilter.SHOW_TEXT); const nodes=[];while(walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const value=node.textContent,lower=value.toLocaleLowerCase(lang);let start=0,index=lower.indexOf(query);if(index<0)continue;const fragment=document.createDocumentFragment();
    while(index>=0 && findMatches.length<500) { fragment.append(document.createTextNode(value.slice(start,index)));const mark=text('mark',value.slice(index,index+query.length),'reader-find-match');fragment.append(mark);findMatches.push(mark);start=index+query.length;index=lower.indexOf(query,start); }fragment.append(document.createTextNode(value.slice(start)));node.replaceWith(fragment);if(findMatches.length>=500)break;
  }
  $('find-count').textContent=findMatches.length?`0 / ${findMatches.length}${findMatches.length===500?'+':''}`:t('noMatches');$('find-previous').disabled=$('find-next').disabled=!findMatches.length;
}
function stepFind(delta) { if(!findMatches.length)return;if(findIndex>=0)findMatches[findIndex].classList.remove('is-current');findIndex=findIndex<0?(delta<0?findMatches.length-1:0):(findIndex+delta+findMatches.length)%findMatches.length;findMatches[findIndex].classList.add('is-current');findMatches[findIndex].scrollIntoView({block:'center'});$('find-count').textContent=`${findIndex+1} / ${findMatches.length}${findMatches.length===500?'+':''}`; }
$('library-button').addEventListener('click',showLibraries);$('contents-button').addEventListener('click',()=>showContents());$('settings-button').addEventListener('click',showSettings);$('panel-close').addEventListener('click',closePanel);panel.addEventListener('close',()=>lastPanelFocus?.focus());
$('back-button').addEventListener('click',()=>{ if(navigationIndex>0)history.back(); });
for (const [id,delta] of [['previous-page',-1],['next-page',1]]) $(id).addEventListener('click',()=>{const sequence=chapterSequence(),index=sequence.indexOf(current?.uuid);if(sequence[index+delta])navigate(sequence[index+delta]);});
$('bookmark-button').addEventListener('click',()=>{if(!current)return;rememberPosition();const index=state.bookmarks.findIndex(saved=>saved.uuid===current.uuid);if(index>=0){state.bookmarks.splice(index,1);notify(t('unsaved'));}else{state.bookmarks.push({uuid:current.uuid,position:surface.scrollTop});state.bookmarks=state.bookmarks.slice(-200);notify(t('saved'));}saveState();const saved=index<0;$('bookmark-button').setAttribute('aria-pressed',String(saved));$('bookmark-button').setAttribute('aria-label',t(saved?'bookmarked':'bookmark'));$('bookmark-button').title=t(saved?'bookmarked':'bookmark');});
$('find-button').addEventListener('click',()=>{$('find-bar').hidden=false;$('find-input').focus();});$('find-close').addEventListener('click',()=>{$('find-bar').hidden=true;$('find-input').value='';clearFind();$('find-button').focus();});$('find-input').addEventListener('input',runFind);$('find-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();stepFind(event.shiftKey?-1:1);}if(event.key==='Escape')$('find-close').click();});$('find-previous').addEventListener('click',()=>stepFind(-1));$('find-next').addEventListener('click',()=>stepFind(1));
prose.addEventListener('click',event=>{
  const link=event.target.closest('a');if(!link || !prose.contains(link))return;
  const uuid=link.dataset.readerUuid;if(uuid){if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();const separator=uuid.indexOf('#');navigate(separator<0?uuid:uuid.slice(0,separator),{anchor:separator<0?'':uuid.slice(separator+1)});return;}
  const href=link.getAttribute('href');if(href?.startsWith('#')){event.preventDefault();navigate(current.uuid,{anchor:href.slice(1)});}
});
surface.addEventListener('scroll',()=>{updateProgress();clearTimeout(scrollTimer);scrollTimer=setTimeout(rememberPosition,250);},{passive:true});window.addEventListener('resize',updateProgress);window.addEventListener('pagehide',rememberPosition);document.addEventListener('visibilitychange',()=>{if(document.hidden)rememberPosition();});
window.addEventListener('popstate',async()=>{
  const url=new URL(location.href),id=url.searchParams.get('library'),uuid=url.searchParams.get('uuid');let anchor='';try{anchor=decodeURIComponent(url.hash.slice(1));}catch{anchor=url.hash.slice(1);}
  if(!id){rememberPosition();loadGeneration++;library=null;lookup.clear();emptyView(t('choose'));return showLibraries();}
  navigationIndex=Math.max(0,Number(history.state?.index)||0);
  if(library?.id!==id)await loadLibrary(id,uuid,{anchor});else if(uuid)navigate(uuid,{anchor,push:false,position:history.state?.position ?? null,remember:false});
});
translateShell();emptyView(t('choose'));
const initialUrl=new URL(location.href),initialId=initialUrl.searchParams.get('library');
if(initialId)await loadLibrary(initialId,initialUrl.searchParams.get('uuid'),{anchor:(()=>{try{return decodeURIComponent(initialUrl.hash.slice(1));}catch{return initialUrl.hash.slice(1);}})()});else await showLibraries();
