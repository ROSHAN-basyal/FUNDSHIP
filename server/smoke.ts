import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const temp=mkdtempSync(join(tmpdir(),'sajilo-smoke-'));const database=join(temp,'smoke.db');const port=8791;const root=`http://127.0.0.1:${port}/api`;
const server=spawn(join(process.cwd(),'node_modules/.bin/tsx'),['server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),SAJILO_DB_PATH:database},stdio:['ignore','pipe','pipe']});
let errors='';server.stderr.on('data',value=>{errors+=String(value)});
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message)}
async function waitForServer(){for(let i=0;i<60;i++){try{if((await fetch(`${root}/health`)).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(`API did not start: ${errors}`)}
async function login(credentialId:string,password:string){const response=await fetch(`${root}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credentialId,password})});const body=await response.json() as any;assert(response.ok,body.error);return body.token as string}
async function api(path:string,token:string,method='GET',body?:unknown){const response=await fetch(`${root}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json() as any;if(!response.ok)throw new Error(`${method} ${path}: ${data.error}`);return data}

try{
  await waitForServer();
  const u1=await login('RB-001','12345678'),u2=await login('NP-002','123456789'),u3=await login('SA-003','welcome123');
  const eventAt=new Date(Date.now()+72*3_600_000).toISOString();
  let admin=await api('/groups/g1/polls',u1,'POST',{title:'Smoke yes/no',eventAt,bsDate:'2083-04-08',minYes:2,deadlineHours:24,pollType:'yes_no'});
  const yesNo=admin.groups.find((group:any)=>group.id==='g1').polls.find((poll:any)=>poll.title==='Smoke yes/no');assert(yesNo,'Yes/no poll was not created');
  admin=await api('/groups/g1/polls',u1,'POST',{title:'Smoke options',eventAt,bsDate:'2083-04-08',minYes:3,deadlineHours:24,pollType:'options',options:['Momo','Thakali']});
  const optionPoll=admin.groups.find((group:any)=>group.id==='g1').polls.find((poll:any)=>poll.title==='Smoke options');assert(optionPoll.options.some((item:any)=>item.id==='nota'),'NOTA was not added');
  await api('/groups/g2/polls',u2,'POST',{title:'Second group poll',eventAt,bsDate:'2083-04-08',minYes:2,deadlineHours:24,pollType:'yes_no'});
  const member=await api('/groups/g1/polls',u2,'POST',{title:'Member approval request',eventAt,bsDate:'2083-04-08',minYes:2,deadlineHours:24,pollType:'yes_no'});
  const pending=member.groups.find((group:any)=>group.id==='g1').polls.find((poll:any)=>poll.title==='Member approval request');assert(pending.approvalStatus==='pending','Member poll did not require approval');
  admin=await api('/bootstrap',u1);assert(admin.notifications.some((item:any)=>item.type==='poll_approval'&&item.entityId===pending.id),'Admin poll approval notification missing');
  await api(`/polls/${pending.id}/approve`,u1,'POST');
  await api(`/polls/${optionPoll.id}/vote`,u1,'POST',{choice:'option_1'});await api(`/polls/${optionPoll.id}/vote`,u2,'POST',{choice:'option_2'});await api(`/polls/${optionPoll.id}/vote`,u3,'POST',{choice:'option_1'});
  admin=await api('/bootstrap',u1);const active=admin.groups.find((group:any)=>group.id==='g1').polls.filter((poll:any)=>poll.status==='open'&&poll.approvalStatus==='approved');assert(active.length>=3,'Multiple active polls were not returned');
  const groupsWithActivePolls=admin.groups.filter((group:any)=>group.polls.some((poll:any)=>poll.status==='open'&&poll.approvalStatus==='approved'));assert(groupsWithActivePolls.length>=2,'Active polls across multiple groups were not returned');
  const db=new DatabaseSync(database);const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  db.prepare(`INSERT INTO users (id,credential_id,name,phone,password_hash,mpin_hash,must_change_password,avatar_color) VALUES (?,?,?,?,?,?,0,?)`).run('u6','ZZ-006','Zoya Zimba','9800000006',hash('welcome123'),hash('1122'),'#557799');
  const u6=await login('ZZ-006','welcome123');await api('/connections/request',u1,'POST',{credentialId:'ZZ-006'});let newcomer=await api('/bootstrap',u6);assert(newcomer.connectionRequests.length===1,'Connection request missing');await api(`/connections/${encodeURIComponent(newcomer.connectionRequests[0].id)}/respond`,u6,'POST',{accept:true});admin=await api('/bootstrap',u1);assert(admin.connections.some((person:any)=>person.id==='u6'),'Accepted connection missing');
  const outsiderVote=await fetch(`${root}/polls/${optionPoll.id}/vote`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${u6}`},body:JSON.stringify({choice:'option_1'})});assert(outsiderVote.status===403,'A non-member was allowed to vote');
  for(let index=1;index<=10;index++)await api('/payments/lend',u2,'POST',{borrowerId:'u1',amount:300+index,purpose:`Smoke burst ${index}`});
  admin=await api('/bootstrap',u1);const burstPayments=admin.payments.incoming.filter((item:any)=>item.purpose.startsWith('Smoke burst '));assert(burstPayments.length===10,'Ten incoming requests were not returned');
  const burstIds=new Set(burstPayments.map((item:any)=>item.id));const burstNotifications=admin.notifications.filter((item:any)=>item.type==='payment_request'&&burstIds.has(item.entityId));assert(burstNotifications.length===10,'Ten payment notifications were not retained in the inbox');
  admin=await api('/notifications/read',u1,'POST');assert(admin.notifications.filter((item:any)=>burstIds.has(item.entityId)).length===10,'Reading notifications removed inbox items');assert(admin.notifications.filter((item:any)=>burstIds.has(item.entityId)).every((item:any)=>item.read),'Notification read state was not persisted');
  db.prepare('INSERT INTO messages (id,group_id,user_id,body,created_at) VALUES (?,?,?,?,?)').run(randomUUID(),'g1','u1','expired smoke chat',new Date(Date.now()-11*86_400_000).toISOString());db.close();admin=await api('/bootstrap',u1);assert(!admin.groups.find((group:any)=>group.id==='g1').messages.some((item:any)=>item.body==='expired smoke chat'),'Old chat was not deleted');
  const db2=new DatabaseSync(database);db2.prepare('UPDATE polls SET deadline_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),optionPoll.id);db2.close();admin=await api('/bootstrap',u1);const completed=admin.groups.find((group:any)=>group.id==='g1').polls.find((poll:any)=>poll.id===optionPoll.id);assert(completed.status==='confirmed'&&completed.winningOptions.includes('option_1'),'Option result was not finalized');const due=admin.notifications.find((item:any)=>item.type==='event_due'&&item.entityId===optionPoll.id);assert(due&&!due.canClear,'Persistent winner reminder missing');
  const clearAttempt=await fetch(`${root}/notifications/${due.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${u1}`}});assert(clearAttempt.status===409,'Persistent event reminder was clearable before the event');
  await api(`/polls/${yesNo.id}`,u1,'DELETE');admin=await api('/bootstrap',u1);assert(!admin.groups.find((group:any)=>group.id==='g1').polls.some((poll:any)=>poll.id===yesNo.id),'Live poll deletion failed');
  console.log(JSON.stringify({ok:true,multipleActive:true,multipleGroups:true,optionVoting:true,nota:true,pollApproval:true,paymentInboxCount:10,notificationReadRetention:true,connections:true,nonMemberVoteBlocked:true,chatRetentionDays:10,persistentWinnerReminder:true,liveDelete:true}));
} finally {server.kill('SIGTERM');rmSync(temp,{recursive:true,force:true})}
