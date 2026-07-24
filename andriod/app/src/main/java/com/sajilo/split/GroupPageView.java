package com.sajilo.split;

import android.app.TimePickerDialog;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.view.animation.AnimationSet;
import android.view.animation.ScaleAnimation;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.widget.NestedScrollView;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

final class GroupPageView extends FrameLayout {
    private final MainActivity host;
    private final JSONObject group;
    private final JSONObject data;
    private final Handler chatSyncHandler=new Handler(Looper.getMainLooper());
    private RecyclerView messagesView;
    private MessageAdapter messageAdapter;
    private boolean chatSyncInFlight;
    private String chatCursorAt="";
    private String chatCursorId="";
    private final Runnable chatSync=new Runnable(){@Override public void run(){refreshMessages();chatSyncHandler.postDelayed(this,5000);}};

    GroupPageView(MainActivity context,MainActivity host,JSONObject group){super(context);this.host=host;this.group=group;this.data=host.data();JSONArray initial=group.optJSONArray("messages");JSONObject last=initial==null||initial.length()==0?null:initial.optJSONObject(initial.length()-1);if(last!=null){chatCursorAt=last.optString("createdAt");chatCursorId=last.optString("id");}build();}

    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();chatSyncHandler.removeCallbacks(chatSync);chatSyncHandler.postDelayed(chatSync,1200);}
    @Override protected void onDetachedFromWindow(){chatSyncHandler.removeCallbacks(chatSync);super.onDetachedFromWindow();}

    private void build(){
        setBackgroundColor(NativeUi.BG);NestedScrollView scroll=new NestedScrollView(getContext());scroll.setFillViewport(true);scroll.setClipToPadding(false);LinearLayout content=new LinearLayout(getContext());content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(15),dp(18),dp(15),dp(30));scroll.addView(content);addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        content.addView(hero(),new LinearLayout.LayoutParams(-1,dp(88)));
        LinearLayout pollHead=new LinearLayout(getContext());pollHead.setGravity(Gravity.CENTER_VERTICAL);pollHead.addView(NativeUi.text(getContext(),"Active Polls",23,NativeUi.INK,true),new LinearLayout.LayoutParams(0,dp(56),1));int historyCount=countPolls(false);View history=historyButton(historyCount);pollHead.addView(history,new LinearLayout.LayoutParams(dp(132),dp(38)));history.setOnClickListener(v->showHistory());content.addView(pollHead,margin(new LinearLayout.LayoutParams(-1,dp(56)),0,15,0,0));
        int active=0;for(JSONObject poll:NativeUi.objects(group.optJSONArray("polls"))){if(!"approved".equals(poll.optString("approvalStatus"))||!"open".equals(poll.optString("status")))continue;active++;content.addView(pollCard(poll),margin(new LinearLayout.LayoutParams(-1,-2),0,0,0,14));}if(active==0){LinearLayout empty=new LinearLayout(getContext());empty.setOrientation(LinearLayout.VERTICAL);empty.setGravity(Gravity.CENTER);empty.setBackground(NativeUi.outlined(getContext(),NativeUi.PAPER,NativeUi.LINE,17));empty.addView(NativeUi.text(getContext(),"No active polls",14,NativeUi.MUTED,true),new LinearLayout.LayoutParams(-2,dp(28)));content.addView(empty,new LinearLayout.LayoutParams(-1,dp(98)));}
        addPending(content);content.addView(chatCard(),margin(new LinearLayout.LayoutParams(-1,-2),0,15,0,0));
    }

    private View hero(){
        LinearLayout row=new LinearLayout(getContext());row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(16),0,dp(13),0);row.setBackground(NativeUi.shape(getContext(),NativeUi.INK,18));
        TextView emoji=NativeUi.text(getContext(),group.optString("emoji","👥"),24,Color.WHITE,true);emoji.setGravity(Gravity.CENTER);emoji.setBackground(NativeUi.ripple(getContext(),NativeUi.outlined(getContext(),Color.rgb(42,83,75),Color.rgb(86,119,111),14)));emoji.setClickable(true);emoji.setFocusable(true);emoji.setContentDescription("Manage "+group.optString("name"));emoji.setOnClickListener(v->showGroupManagement());row.addView(emoji,new LinearLayout.LayoutParams(dp(50),dp(50)));
        LinearLayout words=new LinearLayout(getContext());words.setOrientation(LinearLayout.VERTICAL);words.setGravity(Gravity.CENTER_VERTICAL);words.addView(NativeUi.text(getContext(),group.optString("name"),20,Color.WHITE,true),new LinearLayout.LayoutParams(-1,dp(29)));words.addView(NativeUi.text(getContext(),group.optJSONArray("members").length()+" members · "+("admin".equals(group.optString("role"))?"Admin":"Member"),10,Color.rgb(184,201,196),false),new LinearLayout.LayoutParams(-1,dp(20)));row.addView(words,margin(new LinearLayout.LayoutParams(0,-1,1),11,0,8,0));
        LinearLayout pollAction=new LinearLayout(getContext());pollAction.setOrientation(LinearLayout.VERTICAL);pollAction.setGravity(Gravity.CENTER);pollAction.setBackground(NativeUi.ripple(getContext(),NativeUi.outlined(getContext(),Color.rgb(41,82,74),Color.rgb(86,119,111),12)));TextView plus=NativeUi.text(getContext(),"＋",22,Color.WHITE,false);plus.setGravity(Gravity.CENTER);pollAction.addView(plus,new LinearLayout.LayoutParams(-1,dp(28)));TextView label=NativeUi.text(getContext(),"Poll",9,Color.WHITE,true);label.setGravity(Gravity.TOP|Gravity.CENTER_HORIZONTAL);pollAction.addView(label,new LinearLayout.LayoutParams(-1,dp(18)));row.addView(pollAction,new LinearLayout.LayoutParams(dp(50),dp(52)));pollAction.setOnClickListener(v->showCreatePoll());return row;
    }

    private View historyButton(int count){LinearLayout button=new LinearLayout(getContext());button.setGravity(Gravity.CENTER);button.setBackground(NativeUi.ripple(getContext(),NativeUi.outlined(getContext(),Color.WHITE,NativeUi.LINE,10)));ImageView icon=NativeUi.icon(getContext(),R.drawable.ic_history_outline,NativeUi.INK,5);button.addView(icon,new LinearLayout.LayoutParams(dp(27),dp(27)));button.addView(NativeUi.text(getContext(),"Poll history",10,NativeUi.INK,true));TextView badge=NativeUi.text(getContext(),String.valueOf(count),9,NativeUi.GREEN,true);badge.setGravity(Gravity.CENTER);badge.setBackground(NativeUi.shape(getContext(),NativeUi.GREEN_SOFT,9));button.addView(badge,margin(new LinearLayout.LayoutParams(dp(19),dp(19)),5,0,0,0));return button;}

    private View pollCard(JSONObject poll){
        LinearLayout card=new LinearLayout(getContext());card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(18),dp(16),dp(18),dp(15));card.setBackground(NativeUi.outlined(getContext(),NativeUi.PAPER,NativeUi.LINE,18));NativeUi.elevate(card,3);
        LinearLayout status=new LinearLayout(getContext());status.setGravity(Gravity.CENTER_VERTICAL);TextView dot=NativeUi.text(getContext(),"",1,Color.TRANSPARENT,false);dot.setBackground(NativeUi.shape(getContext(),Color.rgb(54,164,127),5));status.addView(dot,new LinearLayout.LayoutParams(dp(9),dp(9)));AnimationSet breathing=new AnimationSet(true);AlphaAnimation fade=new AlphaAnimation(.45f,1f);ScaleAnimation scale=new ScaleAnimation(.82f,1.16f,.82f,1.16f,Animation.RELATIVE_TO_SELF,.5f,Animation.RELATIVE_TO_SELF,.5f);breathing.addAnimation(fade);breathing.addAnimation(scale);breathing.setDuration(850);breathing.setRepeatMode(Animation.REVERSE);breathing.setRepeatCount(Animation.INFINITE);dot.startAnimation(breathing);TextView open=NativeUi.text(getContext(),"VOTING OPEN",10,NativeUi.GREEN,true);open.setLetterSpacing(.08f);status.addView(open,margin(new LinearLayout.LayoutParams(0,dp(30),1),7,0,5,0));TextView when=NativeUi.text(getContext(),poll.optString("bsDate")+" · "+NativeUi.eventTime(poll.optString("eventAt")),10,NativeUi.MUTED,true);when.setGravity(Gravity.CENTER_VERTICAL|Gravity.END);status.addView(when);if(poll.optBoolean("canDelete")){ImageView delete=NativeUi.iconButton(getContext(),R.drawable.ic_delete_outline,NativeUi.RED,NativeUi.RED_SOFT,9,8);status.addView(delete,margin(new LinearLayout.LayoutParams(dp(32),dp(32)),7,0,0,0));delete.setOnClickListener(v->deletePoll(poll));}card.addView(status,new LinearLayout.LayoutParams(-1,dp(34)));
        TextView title=NativeUi.text(getContext(),poll.optString("title"),21,NativeUi.INK,true);title.setPadding(0,dp(5),0,dp(5));card.addView(title,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout deadline=new LinearLayout(getContext());deadline.setOrientation(LinearLayout.VERTICAL);deadline.setPadding(dp(12),dp(7),dp(12),dp(7));deadline.setBackground(NativeUi.shape(getContext(),Color.rgb(242,240,232),12));deadline.addView(NativeUi.text(getContext(),"◷  Voting closes",10,NativeUi.MUTED,true),new LinearLayout.LayoutParams(-1,dp(19)));deadline.addView(NativeUi.text(getContext(),poll.optString("deadlineBsDate",poll.optString("bsDate"))+" · "+NativeUi.eventTime(poll.optString("deadlineAt")),13,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,dp(24)));card.addView(deadline,margin(new LinearLayout.LayoutParams(-1,dp(57)),0,10,0,0));
        int total=poll.optJSONArray("voteDetails").length(),reached="options".equals(poll.optString("pollType"))?total:poll.optInt("yesCount"),minimum=Math.max(1,poll.optInt("minYes"));LinearLayout progressHead=new LinearLayout(getContext());progressHead.setGravity(Gravity.CENTER_VERTICAL);TextView required=NativeUi.text(getContext(),reached+" of "+minimum+" required",11,NativeUi.INK,true);TextView voted=NativeUi.text(getContext(),total+" voted · tap for details",10,NativeUi.MUTED,false);voted.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);progressHead.addView(required,new LinearLayout.LayoutParams(0,dp(34),1));progressHead.addView(voted,new LinearLayout.LayoutParams(-2,dp(34)));card.addView(progressHead);ProgressBar progress=new ProgressBar(getContext(),null,android.R.attr.progressBarStyleHorizontal);progress.setMax(minimum);progress.setProgress(Math.min(minimum,reached));progress.setProgressTintList(android.content.res.ColorStateList.valueOf(NativeUi.GREEN));progress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(231,232,226)));card.addView(progress,new LinearLayout.LayoutParams(-1,dp(6)));progressHead.setOnClickListener(v->showVotes(poll));progress.setOnClickListener(v->showVotes(poll));
        if("yes_no".equals(poll.optString("pollType"))){LinearLayout votes=new LinearLayout(getContext());TextView yes=voteButton("✓  Yes","yes".equals(poll.optString("myVote")),true),no=voteButton("✕  No","no".equals(poll.optString("myVote")),false);votes.addView(yes,margin(new LinearLayout.LayoutParams(0,dp(45),1),0,0,4,0));votes.addView(no,margin(new LinearLayout.LayoutParams(0,dp(45),1),4,0,0,0));card.addView(votes,margin(new LinearLayout.LayoutParams(-1,dp(45)),0,15,0,0));yes.setOnClickListener(v->vote(poll,"yes"));no.setOnClickListener(v->vote(poll,"no"));}
        else {List<JSONObject> options=NativeUi.objects(poll.optJSONArray("options"));for(int index=0;index<options.size();index+=2){LinearLayout optionRow=new LinearLayout(getContext());for(int column=0;column<2;column++){int optionIndex=index+column;if(optionIndex>=options.size()){optionRow.addView(new View(getContext()),new LinearLayout.LayoutParams(0,dp(44),1));continue;}JSONObject option=options.get(optionIndex);boolean chosen=option.optString("id").equals(poll.optString("myVote"));TextView choice=voteButton(option.optString("label"),chosen,true);optionRow.addView(choice,margin(new LinearLayout.LayoutParams(0,dp(44),1),column==0?0:4,0,column==0?4:0,0));choice.setOnClickListener(v->vote(poll,option.optString("id")));}card.addView(optionRow,margin(new LinearLayout.LayoutParams(-1,dp(44)),0,8,0,0));}}
        TextView by=NativeUi.text(getContext(),"Created by "+NativeUi.displayName(poll.optString("creatorName")),10,NativeUi.MUTED,false);card.addView(by,margin(new LinearLayout.LayoutParams(-1,dp(27)),0,10,0,0));return card;
    }

    private TextView voteButton(String label,boolean selected,boolean positive){int color=positive?NativeUi.GREEN:NativeUi.RED,soft=positive?NativeUi.GREEN_SOFT:NativeUi.RED_SOFT;TextView button=NativeUi.button(getContext(),label,selected?color:NativeUi.MUTED,selected?soft:Color.WHITE,11);button.setTextSize(12);button.setBackground(NativeUi.ripple(getContext(),NativeUi.outlined(getContext(),selected?soft:Color.WHITE,selected?color:NativeUi.LINE,11)));return button;}
    private void vote(JSONObject poll,String choice){JSONObject body=new JSONObject();try{body.put("choice",choice);}catch(Exception ignored){}String pollId=poll.optString("id");host.api().post("/polls/"+pollId+"/vote",body,new FundsApi.Callback(){public void success(JSONObject response){host.acceptPollVote(pollId,choice,response.optLong("revision"));host.toast("Vote recorded");}public void error(String message){host.toast(message);}});}
    private void deletePoll(JSONObject poll){LinearLayout content=new LinearLayout(getContext());content.setOrientation(LinearLayout.VERTICAL);LinearLayout warning=NativeUi.sectionCard(getContext());warning.setBackground(NativeUi.outlined(getContext(),NativeUi.RED_SOFT,Color.rgb(236,196,190),15));warning.addView(NativeUi.text(getContext(),poll.optString("title"),16,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,dp(34)));TextView copy=NativeUi.text(getContext(),"This immediately removes the live poll for every group member. This action cannot be undone.",12,NativeUi.RED,false);copy.setLineSpacing(0,1.12f);warning.addView(copy,new LinearLayout.LayoutParams(-1,-2));content.addView(warning);FundshipSheet.show(getContext(),group.optString("name"),"Delete live poll?","Review the poll before deleting it.",content,"Delete poll",66,sheet->{sheet.dismiss();host.api().delete("/polls/"+poll.optString("id"),host.callbackRefresh("Poll deleted"));});}
    private void showVotes(JSONObject poll){LinearLayout list=new LinearLayout(getContext());list.setOrientation(LinearLayout.VERTICAL);for(JSONObject vote:NativeUi.objects(poll.optJSONArray("voteDetails"))){String choice=vote.optString("choice");if("options".equals(poll.optString("pollType")))for(JSONObject option:NativeUi.objects(poll.optJSONArray("options")))if(choice.equals(option.optString("id")))choice=option.optString("label");list.addView(voteDetailRow(vote,choice),margin(new LinearLayout.LayoutParams(-1,-2),0,0,0,8));}if(poll.optJSONArray("voteDetails").length()==0)list.addView(emptyCard("No votes yet","Votes will appear here as members respond."),new LinearLayout.LayoutParams(-1,dp(116)));FundshipSheet.show(getContext(),group.optString("name"),"Vote details",poll.optString("title"),list,null,82,null);}
    private void showHistory(){LinearLayout list=new LinearLayout(getContext());list.setOrientation(LinearLayout.VERTICAL);int count=0;for(JSONObject poll:NativeUi.objects(group.optJSONArray("polls"))){if("open".equals(poll.optString("status")))continue;count++;list.addView(historyCard(poll),margin(new LinearLayout.LayoutParams(-1,-2),0,0,0,11));}if(count==0)list.addView(emptyCard("No completed polls","Poll results will appear here after voting closes."),new LinearLayout.LayoutParams(-1,dp(124)));FundshipSheet.show(getContext(),group.optString("name"),"Poll history",count==0?"No results recorded yet.":count+" completed poll"+(count==1?"":"s")+" with final results.",list,null,90,null);}
    private String winning(JSONObject poll){List<String> labels=new ArrayList<>();for(Object id:strings(poll.optJSONArray("winningOptions")))for(JSONObject option:NativeUi.objects(poll.optJSONArray("options")))if(id.equals(option.optString("id")))labels.add(option.optString("label"));return labels.isEmpty()?"No winner":String.join(" / ",labels);}

    private void addPending(LinearLayout content){for(JSONObject poll:NativeUi.objects(group.optJSONArray("polls"))){if(!"pending".equals(poll.optString("approvalStatus"))||!"open".equals(poll.optString("status")))continue;LinearLayout item=row(poll.optString("title"),"Requested by "+NativeUi.displayName(poll.optString("creatorName")));if("admin".equals(group.optString("role"))){TextView approve=NativeUi.button(getContext(),"Approve",Color.WHITE,NativeUi.GREEN,9);item.addView(approve,new LinearLayout.LayoutParams(dp(72),dp(36)));approve.setOnClickListener(v->host.verifySensitiveAction("Approve poll request",poll.optString("title"),()->host.api().post("/polls/"+poll.optString("id")+"/approve",new JSONObject(),host.callbackRefresh("Poll approved"))));}content.addView(item,margin(new LinearLayout.LayoutParams(-1,-2),0,6,0,0));}}

    private View chatCard(){LinearLayout card=new LinearLayout(getContext());card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(12),dp(7),dp(12),dp(12));card.setBackground(NativeUi.outlined(getContext(),NativeUi.PAPER,NativeUi.LINE,18));NativeUi.elevate(card,2);TextView title=NativeUi.text(getContext(),"Group Chat",21,NativeUi.INK,true);card.addView(title,new LinearLayout.LayoutParams(-1,dp(52)));title.setOnClickListener(v->showMembers());messagesView=new RecyclerView(getContext());messagesView.setLayoutManager(new LinearLayoutManager(getContext()));messageAdapter=new MessageAdapter(group.optJSONArray("messages"));messagesView.setAdapter(messageAdapter);messagesView.setNestedScrollingEnabled(true);messagesView.setClipToPadding(false);messagesView.setPadding(0,0,0,dp(5));card.addView(messagesView,new LinearLayout.LayoutParams(-1,dp(285)));LinearLayout compose=new LinearLayout(getContext());compose.setGravity(Gravity.CENTER_VERTICAL);EditText body=input("Message "+group.optString("name"),false);compose.addView(body,new LinearLayout.LayoutParams(0,dp(46),1));ImageView send=NativeUi.icon(getContext(),R.drawable.ic_send_outline,Color.WHITE,10);send.setBackground(NativeUi.ripple(getContext(),NativeUi.shape(getContext(),NativeUi.ORANGE,12)));send.setClickable(true);compose.addView(send,margin(new LinearLayout.LayoutParams(dp(42),dp(42)),8,0,0,0));card.addView(compose,margin(new LinearLayout.LayoutParams(-1,dp(46)),0,9,0,0));send.setOnClickListener(v->{String text=body.getText().toString().trim();if(text.isEmpty())return;send.setEnabled(false);JSONObject request=new JSONObject();try{request.put("body",text);}catch(Exception ignored){}host.api().post("/groups/"+group.optString("id")+"/messages",request,new FundsApi.Callback(){public void success(JSONObject response){JSONObject message=response.optJSONObject("message");body.setText("");send.setEnabled(true);if(message!=null){host.acceptChatMessage(group.optString("id"),message,response.optLong("revision"));JSONArray added=new JSONArray();added.put(message);mergeMessages(added,true);}}public void error(String message){send.setEnabled(true);host.toast(message);}});});return card;}

    private void refreshMessages(){if(chatSyncInFlight||messageAdapter==null||!host.isCurrentGroup(group.optString("id")))return;chatSyncInFlight=true;String path="/groups/"+group.optString("id")+"/messages";if(!chatCursorAt.isEmpty())path+="?after="+android.net.Uri.encode(chatCursorAt)+"&afterId="+android.net.Uri.encode(chatCursorId);host.api().get(path,new FundsApi.Callback(){public void success(JSONObject response){chatSyncInFlight=false;JSONObject cursor=response.optJSONObject("cursor");if(cursor!=null){chatCursorAt=cursor.optString("createdAt",chatCursorAt);chatCursorId=cursor.optString("id",chatCursorId);}mergeMessages(response.optJSONArray("messages"),false);}public void error(String ignored){chatSyncInFlight=false;}});}
    private void mergeMessages(JSONArray messages,boolean forceScroll){if(messageAdapter==null||messages==null)return;int before=messageAdapter.getItemCount();messageAdapter.merge(messages);JSONObject last=messages.length()==0?null:messages.optJSONObject(messages.length()-1);if(last!=null){chatCursorAt=last.optString("createdAt",chatCursorAt);chatCursorId=last.optString("id",chatCursorId);}if(messagesView!=null&&(forceScroll||messageAdapter.getItemCount()>before)&&messageAdapter.getItemCount()>0)messagesView.scrollToPosition(messageAdapter.getItemCount()-1);}
    private final class MessageAdapter extends RecyclerView.Adapter<MessageAdapter.Holder>{final List<JSONObject> values;MessageAdapter(JSONArray array){values=NativeUi.objects(array);}void merge(JSONArray array){Set<String> ids=new HashSet<>();for(JSONObject item:values)ids.add(item.optString("id"));int first=values.size();for(JSONObject item:NativeUi.objects(array))if(ids.add(item.optString("id")))values.add(item);if(values.size()>first)notifyItemRangeInserted(first,values.size()-first);}final class Holder extends RecyclerView.ViewHolder{final FrameLayout frame;Holder(FrameLayout v){super(v);frame=v;}}@NonNull public Holder onCreateViewHolder(@NonNull ViewGroup parent,int type){FrameLayout frame=new FrameLayout(getContext());frame.setLayoutParams(new RecyclerView.LayoutParams(-1,-2));frame.setPadding(0,dp(3),0,dp(3));return new Holder(frame);}@Override public void onBindViewHolder(@NonNull Holder h,int p){JSONObject value=values.get(p);h.frame.removeAllViews();boolean mine=data.optJSONObject("user").optString("id").equals(value.optString("userId"));LinearLayout line=new LinearLayout(getContext());line.setGravity(Gravity.BOTTOM);if(!mine){TextView avatar=NativeUi.avatar(getContext(),value.optString("name"),value.optString("avatarColor"),28);line.addView(avatar,margin(new LinearLayout.LayoutParams(dp(28),dp(28)),0,0,6,2));}LinearLayout bubble=new LinearLayout(getContext());bubble.setOrientation(LinearLayout.VERTICAL);bubble.setPadding(dp(10),dp(7),dp(10),dp(6));bubble.setBackground(NativeUi.shape(getContext(),mine?NativeUi.INK:Color.rgb(240,242,237),12));if(!mine)bubble.addView(NativeUi.text(getContext(),NativeUi.displayName(value.optString("name")),9,NativeUi.GREEN,true),new LinearLayout.LayoutParams(-1,dp(16)));bubble.addView(NativeUi.text(getContext(),value.optString("body"),12,mine?Color.WHITE:NativeUi.INK,false),new LinearLayout.LayoutParams(-1,-2));TextView time=NativeUi.text(getContext(),NativeUi.relative(value.optString("createdAt")),8,mine?Color.rgb(183,202,196):NativeUi.MUTED,false);time.setGravity(Gravity.END);bubble.addView(time,new LinearLayout.LayoutParams(-1,dp(15)));line.addView(bubble,new LinearLayout.LayoutParams(-2,-2));FrameLayout.LayoutParams params=new FrameLayout.LayoutParams(-2,-2,mine?Gravity.END:Gravity.START);h.frame.addView(line,params);}@Override public int getItemCount(){return values.size();}}
    private void showMembers(){LinearLayout list=new LinearLayout(getContext());list.setOrientation(LinearLayout.VERTICAL);for(JSONObject member:NativeUi.objects(group.optJSONArray("members")))list.addView(memberRow(member),margin(new LinearLayout.LayoutParams(-1,-2),0,0,0,8));FundshipSheet.show(getContext(),group.optString("name"),"Group members",group.optJSONArray("members").length()+" people can read and send messages in this chat.",list,null,84,null);}

    private void showGroupManagement(){
        boolean admin="admin".equals(group.optString("role"));
        boolean canInvite=group.optBoolean("canInviteMembers",admin);
        String myId=data.optJSONObject("user").optString("id");
        LinearLayout content=new LinearLayout(getContext());content.setOrientation(LinearLayout.VERTICAL);content.setPadding(0,0,0,dp(14));
        FundshipSheet[] sheetRef=new FundshipSheet[1];

        TextView invite=NativeUi.button(getContext(),canInvite?"＋  Add or invite members":"Member invitations are admin-only",canInvite?Color.WHITE:NativeUi.MUTED,canInvite?NativeUi.INK:Color.rgb(242,241,235),13);
        invite.setEnabled(canInvite);invite.setAlpha(canInvite?1f:.72f);content.addView(invite,new LinearLayout.LayoutParams(-1,dp(54)));
        if(canInvite)invite.setOnClickListener(v->{sheetRef[0].dismiss();showInviteMembers();});

        if(admin){
            content.addView(NativeUi.fieldLabel(getContext(),"Invitation settings"),margin(new LinearLayout.LayoutParams(-1,dp(31)),0,18,0,0));
            boolean enabled=group.optBoolean("membersCanInvite");
            LinearLayout setting=NativeUi.sectionCard(getContext());setting.setOrientation(LinearLayout.HORIZONTAL);setting.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout words=new LinearLayout(getContext());words.setOrientation(LinearLayout.VERTICAL);words.addView(NativeUi.text(getContext(),"Members can invite others",14,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,dp(25)));words.addView(NativeUi.text(getContext(),enabled?"Any member may send group invitations.":"Only admins may send group invitations.",10,NativeUi.MUTED,false),new LinearLayout.LayoutParams(-1,dp(20)));setting.addView(words,new LinearLayout.LayoutParams(0,-2,1));
            TextView toggle=NativeUi.button(getContext(),enabled?"Allowed":"Admins only",enabled?NativeUi.GREEN:NativeUi.MUTED,enabled?NativeUi.GREEN_SOFT:Color.rgb(242,241,235),9);setting.addView(toggle,new LinearLayout.LayoutParams(dp(86),dp(38)));content.addView(setting,new LinearLayout.LayoutParams(-1,dp(76)));
            setting.setClickable(true);setting.setFocusable(true);setting.setOnClickListener(v->{sheetRef[0].dismiss();JSONObject body=new JSONObject();try{body.put("membersCanInvite",!enabled);}catch(Exception ignored){}host.api().post("/groups/"+group.optString("id")+"/settings",body,host.callbackRefresh(enabled?"Member invitations disabled":"Member invitations enabled"));});
        }

        JSONArray pending=group.optJSONArray("pendingInvites");
        if(pending!=null&&pending.length()>0){
            content.addView(NativeUi.fieldLabel(getContext(),"Pending invitations"),margin(new LinearLayout.LayoutParams(-1,dp(31)),0,18,0,0));
            for(JSONObject person:NativeUi.objects(pending)){
                LinearLayout item=row(NativeUi.displayName(person.optString("name")),person.optString("credentialId")+" · Waiting for approval");
                TextView badge=NativeUi.text(getContext(),"Pending",9,NativeUi.ORANGE,true);badge.setGravity(Gravity.CENTER);badge.setBackground(NativeUi.shape(getContext(),Color.rgb(252,235,224),9));item.addView(badge,new LinearLayout.LayoutParams(dp(66),dp(31)));content.addView(item,margin(new LinearLayout.LayoutParams(-1,-2),0,0,0,8));
            }
        }

        content.addView(NativeUi.fieldLabel(getContext(),"Members · "+group.optJSONArray("members").length()),margin(new LinearLayout.LayoutParams(-1,dp(31)),0,18,0,0));
        for(JSONObject member:NativeUi.objects(group.optJSONArray("members"))){
            LinearLayout item=memberRow(member);boolean mine=myId.equals(member.optString("id"));
            if(admin&&!mine){
                TextView next=NativeUi.text(getContext(),"›",22,NativeUi.MUTED,false);next.setGravity(Gravity.CENTER);item.addView(next,new LinearLayout.LayoutParams(dp(28),dp(34)));item.setClickable(true);item.setFocusable(true);item.setOnClickListener(v->{sheetRef[0].dismiss();showMemberActions(member);});
            }
            content.addView(item,margin(new LinearLayout.LayoutParams(-1,-2),0,0,0,8));
        }

        if(admin){
            TextView delete=NativeUi.button(getContext(),"Delete group",NativeUi.RED,Color.WHITE,12);delete.setBackground(NativeUi.ripple(getContext(),NativeUi.outlined(getContext(),Color.WHITE,Color.rgb(236,196,190),12)));content.addView(delete,margin(new LinearLayout.LayoutParams(-1,dp(50)),0,20,0,0));delete.setOnClickListener(v->{sheetRef[0].dismiss();confirmDeleteGroup();});
        }
        sheetRef[0]=FundshipSheet.show(getContext(),group.optString("emoji","👥")+"  "+group.optString("name"),admin?"Manage group":"Group details",admin?"Invite people, manage roles, and control this group.":"View members and invite people when admins allow it.",content,null,92,null);
    }

    private void showInviteMembers(){
        Set<String> unavailable=new HashSet<>();for(JSONObject member:NativeUi.objects(group.optJSONArray("members")))unavailable.add(member.optString("id"));for(JSONObject invite:NativeUi.objects(group.optJSONArray("pendingInvites")))unavailable.add(invite.optString("id"));
        List<JSONObject> candidates=new ArrayList<>();for(JSONObject person:NativeUi.objects(data.optJSONArray("connections")))if(!unavailable.contains(person.optString("id")))candidates.add(person);
        LinearLayout form=new LinearLayout(getContext());form.setOrientation(LinearLayout.VERTICAL);form.setPadding(0,0,0,dp(12));
        EditText credential=NativeUi.input(getContext(),"System-issued user ID",false);form.addView(NativeUi.labeled(getContext(),"Invite by user ID",credential,"The person will approve the invitation before joining."),new LinearLayout.LayoutParams(-1,-2));
        form.addView(NativeUi.fieldLabel(getContext(),"Or choose connections"),margin(new LinearLayout.LayoutParams(-1,dp(32)),0,18,0,0));
        List<CheckBox> checks=new ArrayList<>();
        if(candidates.isEmpty()){
            form.addView(emptyCard("No other connections","Enter a user ID above to invite someone directly."),new LinearLayout.LayoutParams(-1,dp(112)));
        }else for(JSONObject person:candidates){
            LinearLayout item=row(NativeUi.displayName(person.optString("name")),person.optString("credentialId"));CheckBox check=new CheckBox(getContext());check.setContentDescription("Invite "+person.optString("name"));item.addView(check,new LinearLayout.LayoutParams(dp(44),dp(44)));item.setOnClickListener(v->check.setChecked(!check.isChecked()));form.addView(item,margin(new LinearLayout.LayoutParams(-1,-2),0,0,0,8));checks.add(check);
        }
        FundshipSheet.show(getContext(),group.optString("name"),"Add members","Send one or more invitations. Nobody joins automatically.",form,"Send invitations",88,sheet->{
            JSONArray ids=new JSONArray();for(int index=0;index<checks.size();index++)if(checks.get(index).isChecked())ids.put(candidates.get(index).optString("id"));String direct=credential.getText().toString().trim();if(ids.length()==0&&direct.isEmpty()){credential.setError("Enter an ID or choose a connection");credential.requestFocus();return;}JSONObject body=new JSONObject();try{body.put("inviteeIds",ids);body.put("credentialId",direct);}catch(Exception ignored){}sheet.setBusy(true,"Sending invitations…","Send invitations");host.api().post("/groups/"+group.optString("id")+"/invites",body,new FundsApi.Callback(){public void success(JSONObject response){sheet.dismiss();host.callbackRefresh(ids.length()+(!direct.isEmpty()?1:0)>1?"Invitations sent":"Invitation sent").success(response);}public void error(String message){sheet.setBusy(false,"","Send invitations");host.toast(message);}});
        });
    }

    private void showMemberActions(JSONObject member){
        boolean targetAdmin="admin".equals(member.optString("role"));
        LinearLayout content=new LinearLayout(getContext());content.setOrientation(LinearLayout.VERTICAL);content.addView(memberRow(member),new LinearLayout.LayoutParams(-1,-2));
        TextView roleAction=NativeUi.button(getContext(),targetAdmin?"Make member":"Make admin",targetAdmin?NativeUi.INK:Color.WHITE,targetAdmin?Color.rgb(239,236,224):NativeUi.GREEN,12);content.addView(roleAction,margin(new LinearLayout.LayoutParams(-1,dp(50)),0,16,0,0));
        TextView remove=NativeUi.button(getContext(),"Remove from group",NativeUi.RED,Color.WHITE,12);remove.setBackground(NativeUi.ripple(getContext(),NativeUi.outlined(getContext(),Color.WHITE,Color.rgb(236,196,190),12)));content.addView(remove,margin(new LinearLayout.LayoutParams(-1,dp(50)),0,9,0,0));
        FundshipSheet[] sheetRef=new FundshipSheet[1];sheetRef[0]=FundshipSheet.show(getContext(),group.optString("name"),NativeUi.displayName(member.optString("name")),"Choose how this person participates in the group.",content,null,68,null);
        roleAction.setOnClickListener(v->{sheetRef[0].dismiss();String role=targetAdmin?"member":"admin";host.verifySensitiveAction(targetAdmin?"Remove admin role":"Make group admin",member.optString("name"),()->{JSONObject body=new JSONObject();try{body.put("role",role);}catch(Exception ignored){}host.api().post("/groups/"+group.optString("id")+"/members/"+member.optString("id")+"/role",body,host.callbackRefresh(targetAdmin?"Member role updated":"New admin added"));});});
        remove.setOnClickListener(v->{sheetRef[0].dismiss();confirmRemoveMember(member);});
    }

    private void confirmRemoveMember(JSONObject member){
        LinearLayout content=new LinearLayout(getContext());content.setOrientation(LinearLayout.VERTICAL);LinearLayout warning=NativeUi.sectionCard(getContext());warning.setBackground(NativeUi.outlined(getContext(),NativeUi.RED_SOFT,Color.rgb(236,196,190),15));warning.addView(NativeUi.text(getContext(),NativeUi.displayName(member.optString("name")),16,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,dp(34)));TextView copy=NativeUi.text(getContext(),"They will lose access to this group's chat and polls. Existing payment connections are not removed.",12,NativeUi.RED,false);copy.setLineSpacing(0,1.12f);warning.addView(copy,new LinearLayout.LayoutParams(-1,-2));content.addView(warning);
        FundshipSheet.show(getContext(),group.optString("name"),"Remove member?","This affects the member immediately.",content,"Remove member",66,sheet->{sheet.dismiss();host.verifySensitiveAction("Remove group member",member.optString("name"),()->host.api().delete("/groups/"+group.optString("id")+"/members/"+member.optString("id"),host.callbackRefresh("Member removed")));});
    }

    private void confirmDeleteGroup(){
        LinearLayout content=new LinearLayout(getContext());content.setOrientation(LinearLayout.VERTICAL);LinearLayout warning=NativeUi.sectionCard(getContext());warning.setBackground(NativeUi.outlined(getContext(),NativeUi.RED_SOFT,Color.rgb(236,196,190),15));warning.addView(NativeUi.text(getContext(),group.optString("name"),17,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,dp(36)));TextView copy=NativeUi.text(getContext(),"This permanently deletes the group, its chat, invitations, polls, votes, and poll history for every member. This cannot be undone.",12,NativeUi.RED,false);copy.setLineSpacing(0,1.12f);warning.addView(copy,new LinearLayout.LayoutParams(-1,-2));content.addView(warning);
        FundshipSheet.show(getContext(),"Permanent action","Delete this group?","Confirm the exact group before continuing.",content,"Delete group",68,sheet->{sheet.dismiss();host.verifySensitiveAction("Delete "+group.optString("name"),"This permanently removes the group for everyone.",()->host.api().delete("/groups/"+group.optString("id"),host.callbackRefresh("Group deleted")));});
    }

    private void showCreatePoll(){
        boolean admin="admin".equals(group.optString("role"));
        LinearLayout form=new LinearLayout(getContext());form.setOrientation(LinearLayout.VERTICAL);form.setPadding(0,0,0,dp(12));

        form.addView(NativeUi.fieldLabel(getContext(),"Poll type"),new LinearLayout.LayoutParams(-1,dp(24)));
        LinearLayout typeToggle=new LinearLayout(getContext());typeToggle.setPadding(dp(4),dp(4),dp(4),dp(4));typeToggle.setBackground(NativeUi.shape(getContext(),Color.rgb(239,239,232),14));
        TextView yesNo=NativeUi.button(getContext(),"Yes / No",NativeUi.INK,Color.WHITE,11);
        TextView optionBased=NativeUi.button(getContext(),"Options",NativeUi.MUTED,Color.TRANSPARENT,11);
        typeToggle.addView(yesNo,margin(new LinearLayout.LayoutParams(0,dp(46),1),0,0,3,0));
        typeToggle.addView(optionBased,margin(new LinearLayout.LayoutParams(0,dp(46),1),3,0,0,0));
        form.addView(typeToggle,new LinearLayout.LayoutParams(-1,dp(54)));

        EditText title=NativeUi.input(getContext(),"What are we deciding?",false);
        LinearLayout titleBlock=NativeUi.labeled(getContext(),"Poll title",title,"Keep it short and clear for everyone in the group.");
        form.addView(titleBlock,margin(new LinearLayout.LayoutParams(-1,-2),0,15,0,0));

        List<EditText> optionInputs=new ArrayList<>();
        LinearLayout optionsBlock=NativeUi.sectionCard(getContext());
        optionsBlock.addView(NativeUi.fieldLabel(getContext(),"Choices"),new LinearLayout.LayoutParams(-1,dp(24)));
        LinearLayout optionList=new LinearLayout(getContext());optionList.setOrientation(LinearLayout.VERTICAL);optionsBlock.addView(optionList,new LinearLayout.LayoutParams(-1,-2));
        addPollOption(optionList,optionInputs);addPollOption(optionList,optionInputs);
        TextView addOption=NativeUi.button(getContext(),"＋  Add another choice",NativeUi.GREEN,NativeUi.GREEN_SOFT,11);addOption.setBackground(NativeUi.ripple(getContext(),NativeUi.outlined(getContext(),NativeUi.GREEN_SOFT,Color.rgb(190,218,209),11)));optionsBlock.addView(addOption,margin(new LinearLayout.LayoutParams(-1,dp(45)),0,4,0,0));
        TextView nota=NativeUi.text(getContext(),"✓  NOTA is included automatically",10,NativeUi.GREEN,true);optionsBlock.addView(nota,margin(new LinearLayout.LayoutParams(-1,dp(29)),2,6,0,0));
        optionsBlock.setVisibility(GONE);form.addView(optionsBlock,margin(new LinearLayout.LayoutParams(-1,-2),0,14,0,0));
        addOption.setOnClickListener(view->{if(optionInputs.size()<6)addPollOption(optionList,optionInputs);else host.toast("You can add up to 6 choices.");});

        TextView schedule=NativeUi.fieldLabel(getContext(),"Schedule");schedule.setTextColor(NativeUi.GREEN);form.addView(schedule,margin(new LinearLayout.LayoutParams(-1,dp(27)),0,18,0,0));
        JSONArray choices=data.optJSONArray("calendarChoices");String[] dateLabels=new String[(choices==null?0:choices.length())+1];
        for(int i=0;i<dateLabels.length-1;i++){JSONObject choice=choices.optJSONObject(i);dateLabels[i]=choice.optString("label")+"  ·  "+choice.optString("bsDate")+" BS";}dateLabels[dateLabels.length-1]="Choose a manual BS date";
        Spinner date=NativeUi.spinner(getContext(),dateLabels);form.addView(NativeUi.labeled(getContext(),"Event date",date,"Quick choices adjust automatically based on today."),new LinearLayout.LayoutParams(-1,-2));

        LinearLayout manual=NativeUi.sectionCard(getContext());
        TextView manualTitle=NativeUi.text(getContext(),"Manual Nepali date",13,NativeUi.INK,true);manual.addView(manualTitle,new LinearLayout.LayoutParams(-1,dp(28)));
        LinearLayout manualFields=new LinearLayout(getContext());Spinner year=numberSpinner(2080,2095),month=numberSpinner(1,12),day=numberSpinner(1,32);manualFields.addView(year,new LinearLayout.LayoutParams(0,dp(52),1));manualFields.addView(month,margin(new LinearLayout.LayoutParams(0,dp(52),1),6,0,6,0));manualFields.addView(day,new LinearLayout.LayoutParams(0,dp(52),1));manual.addView(manualFields,new LinearLayout.LayoutParams(-1,dp(52)));manual.addView(NativeUi.text(getContext(),"Year   ·   Month   ·   Day (BS)",10,NativeUi.MUTED,false),margin(new LinearLayout.LayoutParams(-1,dp(26)),3,5,0,0));manual.setVisibility(GONE);form.addView(manual,margin(new LinearLayout.LayoutParams(-1,-2),0,11,0,0));

        EditText time=NativeUi.input(getContext(),"Select event time",false);time.setText("6:00 PM");time.setFocusable(false);time.setClickable(true);final String[] timeValue={"18:00"};
        time.setOnClickListener(view->new TimePickerDialog(getContext(),(picker,hour,minute)->{timeValue[0]=String.format(Locale.US,"%02d:%02d",hour,minute);time.setText(new SimpleDateFormat("h:mm a",Locale.US).format(timeForDisplay(hour,minute)));},18,0,false).show());
        form.addView(NativeUi.labeled(getContext(),"Event time",time,"Shown in the phone's local time."),margin(new LinearLayout.LayoutParams(-1,-2),0,12,0,0));

        EditText minimum=NativeUi.input(getContext(),"Required votes",true);minimum.setText(String.valueOf(Math.max(1,Math.min(3,group.optJSONArray("members").length()))));
        form.addView(NativeUi.labeled(getContext(),"Required votes",minimum,"Maximum: "+group.optJSONArray("members").length()+" group members."),margin(new LinearLayout.LayoutParams(-1,-2),0,12,0,0));
        Spinner deadline=NativeUi.spinner(getContext(),new String[]{"1 day before","2 days before","3 days before","1 week before","12 hours before","6 hours before","3 hours before"});
        form.addView(NativeUi.labeled(getContext(),"Voting closes",deadline,"The poll closes relative to the event date and time."),margin(new LinearLayout.LayoutParams(-1,-2),0,12,0,0));

        final boolean[] optionMode={false};
        Runnable styleType=()->{yesNo.setTextColor(optionMode[0]?NativeUi.MUTED:NativeUi.INK);yesNo.setBackground(NativeUi.ripple(getContext(),NativeUi.shape(getContext(),optionMode[0]?Color.TRANSPARENT:Color.WHITE,11)));optionBased.setTextColor(optionMode[0]?NativeUi.INK:NativeUi.MUTED);optionBased.setBackground(NativeUi.ripple(getContext(),NativeUi.shape(getContext(),optionMode[0]?Color.WHITE:Color.TRANSPARENT,11)));optionsBlock.setVisibility(optionMode[0]?VISIBLE:GONE);title.setHint(optionMode[0]?"What should the group choose?":"What are we deciding?");};
        yesNo.setOnClickListener(view->{optionMode[0]=false;styleType.run();});optionBased.setOnClickListener(view->{optionMode[0]=true;styleType.run();});styleType.run();
        date.setOnItemSelectedListener(selected(pos->manual.setVisibility(pos==dateLabels.length-1?VISIBLE:GONE)));

        String actionLabel=admin?"Create poll":"Send poll request";
        FundshipSheet.show(getContext(),group.optString("name"),admin?"Create a poll":"Request a poll",admin?"Set the question, schedule and voting rules.":"An admin will review this poll before it goes live.",form,actionLabel,94,sheet->{
            String cleanTitle=title.getText().toString().trim();if(cleanTitle.isEmpty()){title.setError("Enter a poll title");title.requestFocus();return;}
            int minVotes;try{minVotes=Integer.parseInt(minimum.getText().toString().trim());}catch(Exception error){minimum.setError("Enter a valid number");return;}if(minVotes<1||minVotes>group.optJSONArray("members").length()){minimum.setError("Choose 1 to "+group.optJSONArray("members").length());return;}
            List<String> cleanOptions=new ArrayList<>();if(optionMode[0])for(EditText option:optionInputs){String value=option.getText().toString().trim();if(!value.isEmpty())cleanOptions.add(value);}if(optionMode[0]&&cleanOptions.size()<2){optionInputs.get(0).setError("Add at least two choices");return;}
            String rawOptions=String.join(",",cleanOptions),pollType=optionMode[0]?"options":"yes_no";int hours=new int[]{24,48,72,168,12,6,3}[deadline.getSelectedItemPosition()];String min=String.valueOf(minVotes);sheet.setBusy(true,admin?"Creating poll…":"Sending request…",actionLabel);
            if(date.getSelectedItemPosition()==dateLabels.length-1){String bs=year.getSelectedItem()+"-"+two(Integer.parseInt(month.getSelectedItem().toString()))+"-"+two(Integer.parseInt(day.getSelectedItem().toString()));JSONObject request=new JSONObject();try{request.put("bsDate",bs);request.put("time",timeValue[0]);}catch(Exception ignored){}host.api().post("/calendar/convert",request,new FundsApi.Callback(){public void success(JSONObject converted){sheet.dismiss();submitPoll(cleanTitle,converted.optString("eventAt"),converted.optString("bsDate"),min,hours,pollType,rawOptions);}public void error(String message){sheet.setBusy(false,"",actionLabel);host.toast(message);}});}else{JSONObject choice=choices.optJSONObject(date.getSelectedItemPosition());String eventAt=iso(choice.optString("adDate"),timeValue[0]);if(eventAt.isEmpty()){sheet.setBusy(false,"",actionLabel);time.setError("Select a valid time");return;}sheet.dismiss();submitPoll(cleanTitle,eventAt,choice.optString("bsDate"),min,hours,pollType,rawOptions);}
        });
    }

    private void addPollOption(LinearLayout list,List<EditText> inputs){EditText option=NativeUi.input(getContext(),"Option "+(inputs.size()+1),false);inputs.add(option);list.addView(option,margin(new LinearLayout.LayoutParams(-1,dp(50)),0,0,0,8));}
    private Date timeForDisplay(int hour,int minute){Calendar calendar=Calendar.getInstance();calendar.set(Calendar.HOUR_OF_DAY,hour);calendar.set(Calendar.MINUTE,minute);return calendar.getTime();}

    private void submitPoll(String title,String eventAt,String bsDate,String minimum,int deadline,String type,String rawOptions){JSONObject body=new JSONObject();JSONArray options=new JSONArray();for(String value:rawOptions.split(","))if(!value.trim().isEmpty())options.put(value.trim());try{body.put("title",title);body.put("eventAt",eventAt);body.put("bsDate",bsDate);body.put("minYes",Integer.parseInt(minimum));body.put("deadlineHours",deadline);body.put("pollType",type);body.put("options",options);}catch(Exception ignored){}host.api().post("/groups/"+group.optString("id")+"/polls",body,host.callbackRefresh("admin".equals(group.optString("role"))?"Poll created":"Poll request sent"));}
    private String iso(String adDate,String time){try{SimpleDateFormat local=new SimpleDateFormat("yyyy-MM-dd HH:mm",Locale.US);Date date=local.parse(adDate+" "+time);SimpleDateFormat utc=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);utc.setTimeZone(TimeZone.getTimeZone("UTC"));return utc.format(date);}catch(Exception ignored){return "";}}

    private int countPolls(boolean active){int count=0;for(JSONObject poll:NativeUi.objects(group.optJSONArray("polls")))if(active=="open".equals(poll.optString("status")))count++;return count;}
    private View historyCard(JSONObject poll){
        boolean confirmed="confirmed".equals(poll.optString("status"));int color=confirmed?NativeUi.GREEN:NativeUi.RED,soft=confirmed?NativeUi.GREEN_SOFT:NativeUi.RED_SOFT;
        LinearLayout card=NativeUi.sectionCard(getContext());card.setPadding(dp(14),dp(13),dp(14),dp(13));
        LinearLayout meta=new LinearLayout(getContext());meta.setGravity(Gravity.CENTER_VERTICAL);TextView status=NativeUi.text(getContext(),confirmed?"CONFIRMED":"CANCELLED",9,color,true);status.setLetterSpacing(.08f);status.setGravity(Gravity.CENTER);status.setBackground(NativeUi.shape(getContext(),soft,9));meta.addView(status,new LinearLayout.LayoutParams(dp(86),dp(27)));TextView when=NativeUi.text(getContext(),poll.optString("bsDate")+" · "+NativeUi.eventTime(poll.optString("eventAt")),10,NativeUi.MUTED,true);when.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);meta.addView(when,new LinearLayout.LayoutParams(0,dp(27),1));card.addView(meta,new LinearLayout.LayoutParams(-1,dp(29)));
        TextView title=NativeUi.text(getContext(),poll.optString("title"),17,NativeUi.INK,true);title.setPadding(0,dp(5),0,dp(5));card.addView(title,new LinearLayout.LayoutParams(-1,-2));
        String result="options".equals(poll.optString("pollType"))?winning(poll):poll.optInt("yesCount")+" Yes · "+poll.optInt("noCount")+" No";TextView resultText=NativeUi.text(getContext(),"Result  ·  "+result,12,color,true);card.addView(resultText,margin(new LinearLayout.LayoutParams(-1,dp(30)),0,5,0,0));
        int votes=poll.optJSONArray("voteDetails").length();TextView turnout=NativeUi.text(getContext(),votes+" vote"+(votes==1?"":"s")+" recorded · required "+poll.optInt("minYes"),10,NativeUi.MUTED,false);card.addView(turnout,new LinearLayout.LayoutParams(-1,dp(23)));return card;
    }
    private View voteDetailRow(JSONObject vote,String choice){LinearLayout item=new LinearLayout(getContext());item.setGravity(Gravity.CENTER_VERTICAL);item.setPadding(dp(11),dp(10),dp(11),dp(10));item.setBackground(NativeUi.outlined(getContext(),Color.WHITE,NativeUi.LINE,13));TextView avatar=NativeUi.avatar(getContext(),vote.optString("name"),vote.optString("avatarColor"),40);item.addView(avatar,new LinearLayout.LayoutParams(dp(40),dp(40)));LinearLayout words=new LinearLayout(getContext());words.setOrientation(LinearLayout.VERTICAL);words.addView(NativeUi.text(getContext(),NativeUi.displayName(vote.optString("name")),14,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,dp(22)));words.addView(NativeUi.text(getContext(),NativeUi.relative(vote.optString("createdAt")),10,NativeUi.MUTED,false),new LinearLayout.LayoutParams(-1,dp(18)));item.addView(words,margin(new LinearLayout.LayoutParams(0,-2,1),10,0,8,0));TextView answer=NativeUi.text(getContext(),choice,11,NativeUi.GREEN,true);answer.setGravity(Gravity.CENTER);answer.setMaxWidth(dp(126));answer.setBackground(NativeUi.shape(getContext(),NativeUi.GREEN_SOFT,9));answer.setPadding(dp(10),0,dp(10),0);item.addView(answer,new LinearLayout.LayoutParams(-2,dp(34)));return item;}
    private LinearLayout memberRow(JSONObject member){LinearLayout item=new LinearLayout(getContext());item.setGravity(Gravity.CENTER_VERTICAL);item.setPadding(dp(11),dp(10),dp(11),dp(10));item.setBackground(NativeUi.outlined(getContext(),Color.WHITE,NativeUi.LINE,13));TextView avatar=NativeUi.avatar(getContext(),member.optString("name"),member.optString("avatarColor"),42);item.addView(avatar,new LinearLayout.LayoutParams(dp(42),dp(42)));LinearLayout words=new LinearLayout(getContext());words.setOrientation(LinearLayout.VERTICAL);words.addView(NativeUi.text(getContext(),NativeUi.displayName(member.optString("name")),14,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,dp(23)));words.addView(NativeUi.text(getContext(),member.optString("credentialId"),10,NativeUi.MUTED,false),new LinearLayout.LayoutParams(-1,dp(18)));item.addView(words,margin(new LinearLayout.LayoutParams(0,-2,1),10,0,8,0));boolean admin="admin".equals(member.optString("role"));TextView role=NativeUi.text(getContext(),admin?"Admin":"Member",10,admin?NativeUi.GREEN:NativeUi.MUTED,true);role.setGravity(Gravity.CENTER);role.setBackground(NativeUi.shape(getContext(),admin?NativeUi.GREEN_SOFT:Color.rgb(243,242,237),9));item.addView(role,new LinearLayout.LayoutParams(dp(66),dp(31)));return item;}
    private View emptyCard(String title,String subtitle){LinearLayout empty=NativeUi.sectionCard(getContext());empty.setGravity(Gravity.CENTER);TextView heading=NativeUi.text(getContext(),title,15,NativeUi.INK,true);heading.setGravity(Gravity.CENTER);empty.addView(heading,new LinearLayout.LayoutParams(-1,dp(37)));TextView copy=NativeUi.text(getContext(),subtitle,11,NativeUi.MUTED,false);copy.setGravity(Gravity.CENTER);copy.setTextAlignment(TEXT_ALIGNMENT_CENTER);empty.addView(copy,new LinearLayout.LayoutParams(-1,dp(45)));return empty;}
    private LinearLayout row(String title,String subtitle){LinearLayout row=new LinearLayout(getContext());row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(10),dp(9),dp(8),dp(9));row.setBackground(NativeUi.outlined(getContext(),Color.WHITE,NativeUi.LINE,12));LinearLayout words=new LinearLayout(getContext());words.setOrientation(LinearLayout.VERTICAL);words.addView(NativeUi.text(getContext(),title,14,NativeUi.INK,true));words.addView(NativeUi.text(getContext(),subtitle,11,NativeUi.MUTED,false));row.addView(words,new LinearLayout.LayoutParams(0,-2,1));return row;}
    private LinearLayout dialogContent(){LinearLayout value=new LinearLayout(getContext());value.setOrientation(LinearLayout.VERTICAL);value.setPadding(dp(8),dp(8),dp(8),dp(8));return value;}private ScrollView scroll(View child,int height){ScrollView value=new ScrollView(getContext());value.addView(child);value.setLayoutParams(new ViewGroup.LayoutParams(-1,dp(height)));return value;}
    private EditText input(String hint,boolean number){return NativeUi.input(getContext(),hint,number);}private Spinner spinner(String[] values){return NativeUi.spinner(getContext(),values);}private Spinner numberSpinner(int start,int end){String[] values=new String[end-start+1];for(int i=start;i<=end;i++)values[i-start]=String.valueOf(i);return NativeUi.spinner(getContext(),values);}
    private android.widget.AdapterView.OnItemSelectedListener selected(java.util.function.IntConsumer value){return new android.widget.AdapterView.OnItemSelectedListener(){public void onItemSelected(android.widget.AdapterView<?> p,View v,int pos,long id){value.accept(pos);}public void onNothingSelected(android.widget.AdapterView<?> p){}};}
    private List<Object> strings(JSONArray array){List<Object> values=new ArrayList<>();if(array!=null)for(int i=0;i<array.length();i++)values.add(array.opt(i));return values;}private String two(int value){return String.format(Locale.US,"%02d",value);}private LinearLayout.LayoutParams rowParams(){return new LinearLayout.LayoutParams(-1,dp(50));}private int dp(int value){return NativeUi.dp(getContext(),value);}private <T extends ViewGroup.MarginLayoutParams>T margin(T value,int l,int t,int r,int b){return NativeUi.margins(getContext(),value,l,t,r,b);}
}
