  /* ================= Scan facture : prix corrigeable + règle mémorisée ================= */

  function invNum(v){ return Number(String(v==null?'':v).replace(',','.'))||0; }

  /* Trois façons de calculer le prix d'UN paquet à partir d'une ligne de facture */
  function invCands(l){
    const qty = invNum(l.qty), box = invNum(l.perBox), price = invNum(l.price), total = invNum(l.total);
    return {
      total: (total>0 && qty>0 && box>0) ? total/(qty*box) : 0,  /* montant HT de la ligne ÷ (caisses × paquets) */
      unit : price>0 ? price : 0,                                 /* le prix lu est déjà le prix d'un paquet */
      box  : (price>0 && box>0) ? price/box : 0                   /* le prix lu est le prix d'une caisse */
    };
  }
  function invAuto(c){
    if(c.total>0){
      if(c.unit>0 && Math.abs(c.unit-c.total)/c.total <= 0.01) return c.unit;
      return c.total;
    }
    return c.box;
  }
  /* Prix d'un paquet : correction manuelle > règle mémorisée > calcul automatique */
  function invPer(l){
    const man = invNum(l.manual);
    if(man>0) return man;
    const c = invCands(l);
    const mode = l.mode || 'auto';
    if(mode!=='auto' && c[mode]>0) return c[mode];
    return invAuto(c);
  }
  /* Quelle règle redonne le prix corrigé à la main ? (tolérance 2 %) */
  function invLearnMode(l){
    const man = invNum(l.manual);
    if(!(man>0)) return null;
    const c = invCands(l);
    let best = null;
    ['total','unit','box'].forEach(m=>{
      if(c[m]>0 && Math.abs(c[m]-man)/man <= 0.02){
        if(best===null || Math.abs(c[m]-man) < Math.abs(c[best]-man) - 1e-9) best = m;
      }
    });
    return best;
  }
  function invFmt(v){ return v>0 ? String(Math.round(v*10000)/10000) : ''; }

  function showInvoiceLinesSheet(photo, sup, lines, amount){
    return new Promise(resolve=>{
      const back = document.createElement('div');
      back.className = 'backdrop';
      document.body.appendChild(back);
      const flagOf = l => invNum(l.manual)>0 ? '✎ corrigé à la main' : '';
      function draw(){
        const prods = state.settings.products.filter(p=>p.supplierId===sup.id);
        back.innerHTML = '<div class="sheet"><div class="sheet-head"><h2>Facture '+escapeHtml(sup.name)+'</h2><button class="icon-btn" data-x>✕</button></div>'
          +(photo?'<img src="'+photo+'" class="photo-thumb" style="max-height:120px;">':'')
          +'<div class="tax-note" style="padding:0 2px 8px;">Vérifie le prix d’un paquet pour chaque ligne. Si c’est faux, corrige-le : l’app retiendra la bonne règle pour ce produit.</div>'
          +'<div class="card">'+(lines.length ? lines.map((l,i)=>
            '<div class="field-row" style="flex-direction:column;align-items:stretch;gap:6px;"><div style="font-size:11px;color:var(--muted);">'+escapeHtml(l.name)+(l.known?' · ✓ mémorisé':'')+'</div>'
            +'<select class="field-select" data-p="'+i+'"><option value="">— produit —</option>'
            +prods.map(p=>'<option value="'+p.id+'" '+(p.id===l.pid?'selected':'')+'>'+escapeHtml(p.name)+'</option>').join('')
            +'<option value="__new__">+ Nouveau produit…</option><option value="__skip__" '+(l.pid==='__skip__'?'selected':'')+'>Ne pas suivre en stock</option></select>'
            +((l.pid && l.pid!=='__skip__')
              ? '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;"><input class="field-input decnum" style="width:46px;" data-q="'+i+'" value="'+l.qty+'"> caisse(s) × <input class="field-input decnum" style="width:46px;" data-b="'+i+'" value="'+l.perBox+'"> paquets</div>'
                +'<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;">Prix d’un paquet : <input class="field-input decnum" style="width:78px;" data-pr="'+i+'" value="'+invFmt(invPer(l))+'" placeholder="—"> € <span id="pf'+i+'" style="font-size:11px;color:var(--amber);">'+flagOf(l)+'</span></div>'
                +'<div style="font-size:10.5px;color:var(--muted);">Lu sur la facture : '+(invNum(l.price)>0?'prix '+fmtMoney(l.price):'prix illisible')+(invNum(l.total)>0?' · total ligne '+fmtMoney(l.total):'')+'</div>'
              : '')
            +'</div>').join('') : '<div class="tax-note" style="padding:12px;">Aucune ligne lue sur cette facture.</div>')+'</div>'
          +'<div class="card" style="margin-top:12px;"><div class="field-row"><span class="field-label">Total TTC (Achats)</span><div class="field-input-wrap"><input class="field-input decnum" id="invAmt" value="'+(amount||'')+'"><span class="field-suffix">€</span></div></div></div>'
          +'<button class="btn btn-primary" data-save>Enregistrer</button></div>';

        back.querySelector('[data-x]').onclick = ()=>{ document.body.removeChild(back); resolve(null); };

        back.querySelectorAll('[data-p]').forEach(el=>el.onchange = ()=>{
          const l = lines[Number(el.dataset.p)];
          if(el.value==='__new__'){
            const name = (prompt('Nom du nouveau produit ?', l.name)||'').trim();
            if(!name){ draw(); return; }
            const p = { id: uid('p'), name, supplierId: sup.id, unitPrice: 0 };
            state.settings.products.push(p); l.pid = p.id;
          } else {
            l.pid = el.value;
            const p = state.settings.products.find(x=>x.id===l.pid);
            if(p && p.perBox && !invNum(l.perBox)) l.perBox = String(p.perBox);
          }
          l.known = false; l.manual = ''; draw();
        });

        back.querySelectorAll('[data-q],[data-b]').forEach(el=>el.oninput = ()=>{
          const isQ = el.dataset.q!==undefined, i = Number(isQ ? el.dataset.q : el.dataset.b);
          if(isQ) lines[i].qty = el.value.replace(',','.'); else lines[i].perBox = el.value.replace(',','.');
          const e = back.querySelector('[data-pr="'+i+'"]');
          if(e && !(invNum(lines[i].manual)>0)) e.value = invFmt(invPer(lines[i]));
        });

        back.querySelectorAll('[data-pr]').forEach(el=>{
          const i = Number(el.dataset.pr);
          el.oninput = ()=>{
            lines[i].manual = el.value.replace(',','.');
            const f = back.querySelector('#pf'+i); if(f) f.textContent = flagOf(lines[i]);
          };
          el.onchange = ()=>{
            if(!(invNum(el.value)>0)){
              lines[i].manual = '';
              el.value = invFmt(invPer(lines[i]));
              const f = back.querySelector('#pf'+i); if(f) f.textContent = '';
            }
          };
        });

        back.querySelector('#invAmt').oninput = e=>{ amount = e.target.value.replace(',','.'); };

        back.querySelector('[data-save]').onclick = ()=>{
          const bad = lines.some(l=>!l.pid || (l.pid!=='__skip__' && !(invNum(l.perBox)>0 && invNum(l.qty)>0)));
          if(bad){ alert('Pour chaque ligne : choisis le produit (ou « Ne pas suivre ») et le nombre de paquets par caisse.'); return; }
          document.body.removeChild(back); resolve({ lines: lines, amount: invNum(amount) });
        };
      }
      draw();
    });
  }

  async function startInvoiceScanFlow(){
    const photo = await capturePhoto();
    if(!photo){ showToast('Aucune photo — rien enregistré'); return; }
    const hide = showLoadingOverlay('Lecture de la facture par l’IA…');
    let r;
    try{ r = await recognizeInvoiceLines(photo); } finally{ hide(); }
    const supplier = await resolveSupplierFromName(r.supplierName, r.error);
    if(!supplier){ showToast('Annulé : aucun fournisseur choisi — rien enregistré'); return; }
    const s = state.settings;
    s.invoiceMap = s.invoiceMap || {};
    const prods = s.products.filter(p=>p.supplierId===supplier.id);
    const raw = Array.isArray(r.lines) ? r.lines : [];
    const lines = raw.map(l=>{
      const m = s.invoiceMap[supplier.id+'|'+normalizeName(l.name)];
      const known = !!(m && (m.pid==='__skip__' || s.products.some(p=>p.id===m.pid)));
      const pid = known ? m.pid : guessProduct(l.name, prods);
      const p = s.products.find(x=>x.id===pid);
      const cond = Number(l.cond)>0 ? Number(l.cond) : 0;
      const box = (known && m.perBox) ? m.perBox : (cond || guessBox(l.name) || (p && p.perBox) || '');
      return { name:l.name, qty:String(l.quantity), price:Number(l.unitPrice)||0, total:Number(l.total)||0,
               pid, perBox:String(box), known, mode:(known && m.mode) ? m.mode : 'auto', manual:'' };
    });
    const out = await showInvoiceLinesSheet(photo, supplier, lines, r.amount);
    if(!out){ showToast('Annulé — rien enregistré'); return; }
    try{
      const d = state.selectedDate, mk = monthKeyOf(d), day = d.getDate();
      const sm = await getStock(supplier.id, mk);
      let nStock = 0, notLearned = 0;
      out.lines.forEach(l=>{
        const key = supplier.id+'|'+normalizeName(l.name);
        if(l.pid==='__skip__'){ s.invoiceMap[key] = { pid:'__skip__' }; return; }
        const p = s.products.find(x=>x.id===l.pid), box = invNum(l.perBox), qty = invNum(l.qty);
        const per = invPer(l);
        let mode = l.mode || 'auto';
        if(invNum(l.manual)>0){
          const lm = invLearnMode(l);
          if(lm) mode = lm; else notLearned++;
        }
        p.perBox = box;
        if(per>0) p.unitPrice = Math.round(per*10000)/10000;
        s.invoiceMap[key] = { pid:p.id, perBox:box, mode:mode };
        sm.entree.push({ day, productId:p.id, qty: Math.round(qty*box*10000)/10000 });
        nStock++;
      });
      if(nStock) await saveStock(supplier.id, mk);
      const cat = s.expenseCategories.find(c=>c.id==='c8') || s.expenseCategories.find(c=>c.linksSupplier);
      if(out.amount>0 && cat){
        const month = await getMonth(mk);
        if(!month.days[String(day)]) month.days[String(day)] = emptyDay();
        const dd = month.days[String(day)];
        if(!dd.receipts) dd.receipts = [];
        dd.expenses[cat.id] = Number(dd.expenses[cat.id]||0) + out.amount;
        dd.receipts.push({ id: uid('rc'), kind:'expense', amount: out.amount, catId: cat.id, supplierId: supplier.id, photo, ts: Date.now() });
        await saveMonth(mk);
      }
      await saveSettings();
      showToast('✓ '+nStock+' produit(s) en stock · prix mis à jour'+(out.amount>0?' · '+fmtMoney(out.amount)+' en Achats':'')+(notLearned?' · '+notLearned+' prix corrigé(s) non mémorisé(s) (aucune règle ne correspond)':''));
      render();
    }catch(e){
      alert('Erreur pendant l’enregistrement : '+e.message+'\nVérifie le stock et les Achats avant de réessayer, une partie a pu être enregistrée.');
    }
  }
