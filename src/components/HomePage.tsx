import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Clock3, Plus, ReceiptText, Send, Sparkles, TrendingUp, UserRoundPlus, Users } from 'lucide-react';
import { Avatar } from './Avatar';
import { displayName, money } from '../lib/format';
import { LendModal, PendingModal, PersonPickerModal, SplitModal, TransactionHistoryModal } from './PaymentDialogs';
import type { Bootstrap, User } from '../types';

export function HomePage({ data, onData, notify }: { data:Bootstrap; onData:(d:Bootstrap)=>void; notify:(s:string)=>void }) {
  const [pendingMode,setPendingMode]=useState<'incoming'|'outgoing'|null>(null);
  const [lendPerson,setLendPerson]=useState<User|null>(null);
  const [pickPerson,setPickPerson]=useState(false);
  const [historyPerson,setHistoryPerson]=useState<User|null>(null);
  const [splitOpen,setSplitOpen]=useState(false);
  const peopleById = new Map(data.people.map(p=>[p.id,p]));

  return <>
    <div className="page-scroll home-page">
      <section className="home-hero">
        <div><span className="eyebrow">Personal accounts</span><h1>Money + Friends + Accounts</h1></div>
        <div className="pending-actions">
          <button onClick={()=>setPendingMode('incoming')}><span className="pending-icon incoming"><ArrowDownLeft size={19}/>{data.payments.incoming.length>0&&<i>{data.payments.incoming.length}</i>}</span><span><small>Incoming</small><strong>{data.payments.incoming.length} request{data.payments.incoming.length===1?'':'s'}</strong></span><ChevronRight size={18}/></button>
          <button onClick={()=>setPendingMode('outgoing')}><span className="pending-icon outgoing"><ArrowUpRight size={19}/>{data.payments.outgoing.length>0&&<i>{data.payments.outgoing.length}</i>}</span><span><small>Outgoing</small><strong>{data.payments.outgoing.length} pending</strong></span><ChevronRight size={18}/></button>
        </div>
      </section>

      <section className="balance-grid">
        <article className="balance-card positive"><div className="balance-top"><span><ArrowDownLeft size={17}/> Owed to you</span><TrendingUp size={20}/></div><strong>{money(data.totals.owedToYou)}</strong><small>Across {data.ledger.filter(x=>x.amount>0).length} people</small></article>
        <article className="balance-card negative"><div className="balance-top"><span><ArrowUpRight size={17}/> You owe</span><ReceiptText size={20}/></div><strong>{money(data.totals.youOwe)}</strong><small>Across {data.ledger.filter(x=>x.amount<0).length} people</small></article>
      </section>

      <div className="payment-cta-row">
        <button className="split-cta individual-cta" onClick={()=>setPickPerson(true)}><span className="split-cta-icon"><UserRoundPlus size={23}/></span><strong>Individual payment request</strong><span className="cta-arrow"><Send size={19}/></span></button>
        <button className="split-cta" onClick={()=>setSplitOpen(true)}><span className="split-cta-icon"><Users size={23}/></span><strong>Group payment request</strong><span className="cta-arrow"><Send size={19}/></span></button>
      </div>

      <section className="ledger-section">
        <header className="section-header"><div><span className="eyebrow">Your balances</span><h2>Ledger</h2></div><div className="ledger-net"><span className="green">{money(data.totals.owedToYou)}</span><span className="red">{money(data.totals.youOwe)}</span></div></header>
        <div className="ledger-list">
          {data.ledger.map(item=>{
            const person=peopleById.get(item.personId) || {id:item.personId,name:item.name,avatarColor:item.avatarColor,credentialId:''};
            const positive=item.amount>0;
            return <article className="ledger-row" key={item.personId}>
              <button className="ledger-person-button" onClick={()=>setHistoryPerson(person)} aria-label={`View transactions with ${item.name}`}><Avatar name={item.name} color={item.avatarColor} size="lg"/><span className="ledger-person"><strong>{displayName(item.name)}</strong><small>{positive?'owes you':'you owe them'}</small></span></button>
              <strong className={`ledger-amount ${positive?'green':'red'}`}>{positive?'+':'−'} {money(Math.abs(item.amount))}</strong>
              <button className="add-lend" onClick={()=>setLendPerson(person)} aria-label={`Record money lent to ${item.name}`}><Plus size={20}/></button>
            </article>;
          })}
          {data.ledger.length===0&&<div className="empty-state"><Sparkles size={30}/><strong>You’re all settled</strong><p>No open balances with anyone.</p></div>}
        </div>
        <div className="quick-lend"><div><Clock3 size={17}/><span><strong>Lent someone cash?</strong><small>Add a request for them to verify.</small></span></div><div className="quick-people">{data.people.slice(0,4).map(person=><button key={person.id} onClick={()=>setLendPerson(person)} title={person.name}><Avatar name={person.name} color={person.avatarColor} size="sm"/><Plus size={12}/></button>)}</div></div>
      </section>
      <p className="retention-note">Payment records remain in your ledger until settled.</p>
    </div>
    {pendingMode&&<PendingModal mode={pendingMode} data={data} onClose={()=>setPendingMode(null)} onData={onData} notify={notify}/>}
    {lendPerson&&<LendModal person={lendPerson} onClose={()=>setLendPerson(null)} onData={onData} notify={notify}/>}
    {pickPerson&&<PersonPickerModal people={data.people} onClose={()=>setPickPerson(false)} onSelect={person=>{setPickPerson(false);setLendPerson(person)}}/>}
    {historyPerson&&<TransactionHistoryModal person={historyPerson} data={data} onClose={()=>setHistoryPerson(null)}/>}
    {splitOpen&&<SplitModal data={data} onClose={()=>setSplitOpen(false)} onData={onData} notify={notify}/>}
  </>;
}
