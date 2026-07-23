package com.sajilo.split;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withContentDescription;
import static androidx.test.espresso.matcher.ViewMatchers.withText;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.app.KeyguardManager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.Assume;
import org.junit.runner.RunWith;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

/** Regression coverage for the native toolbar hit target and the unified sheets. */
@RunWith(AndroidJUnit4.class)
public class NativeSheetsInstrumentedTest {
    @Test public void notificationAndPollHistorySheetsOpen() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        KeyguardManager keyguard=(KeyguardManager)context.getSystemService(Context.KEYGUARD_SERVICE);
        Assume.assumeFalse("The UI regression test requires an unlocked device",keyguard!=null&&keyguard.isDeviceLocked());
        SharedPreferences secure=context.getSharedPreferences("fundship_secure_session",Context.MODE_PRIVATE);
        String ciphertext=secure.getString("ciphertext","");String iv=secure.getString("iv","");String credential=secure.getString("credentialId","");
        secure.edit().clear().commit();
        MainActivity activity=null;
        try {
            Intent intent=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK);
            activity=(MainActivity)InstrumentationRegistry.getInstrumentation().startActivitySync(intent);
            MainActivity target=activity;JSONObject bootstrap=bootstrap();
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
                try {Field data=MainActivity.class.getDeclaredField("data");data.setAccessible(true);data.set(target,bootstrap);Method shell=MainActivity.class.getDeclaredMethod("buildShell");shell.setAccessible(true);shell.invoke(target);}
                catch(Exception error){throw new RuntimeException(error);}
            });

            onView(withContentDescription("Open notifications")).perform(click());
            onView(withText("Notifications")).check(matches(isDisplayed()));
            onView(withText("Test notification")).check(matches(isDisplayed()));
            onView(withContentDescription("Close")).perform(click());

            Field pagerField=MainActivity.class.getDeclaredField("pager");pagerField.setAccessible(true);
            androidx.viewpager2.widget.ViewPager2 pager=(androidx.viewpager2.widget.ViewPager2)pagerField.get(activity);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->pager.setCurrentItem(1,false));
            onView(withText("Poll history")).perform(click());
            onView(withText("Poll history")).check(matches(isDisplayed()));
            onView(withText("Dinner plan")).check(matches(isDisplayed()));
        } finally {
            if(activity!=null){MainActivity closing=activity;InstrumentationRegistry.getInstrumentation().runOnMainSync(closing::finish);}
            SharedPreferences.Editor restore=secure.edit().clear();if(!ciphertext.isEmpty())restore.putString("ciphertext",ciphertext);if(!iv.isEmpty())restore.putString("iv",iv);if(!credential.isEmpty())restore.putString("credentialId",credential);restore.commit();
        }
    }

    private JSONObject bootstrap() throws Exception {
        JSONObject user=new JSONObject().put("id","u1").put("credentialId","RB-001").put("name","Roshan Basyal").put("avatarColor","#e7864a");
        JSONObject completed=new JSONObject().put("id","history-1").put("title","Dinner plan").put("eventAt","2026-07-25T12:15:00.000Z").put("bsDate","९ साउन २०८३").put("deadlineAt","2026-07-24T12:15:00.000Z").put("deadlineBsDate","८ साउन २०८३").put("minYes",2).put("status","confirmed").put("approvalStatus","approved").put("creatorName","Roshan Basyal").put("creatorId","u1").put("pollType","yes_no").put("yesCount",3).put("noCount",1).put("voteDetails",new JSONArray().put(new JSONObject().put("userId","u1").put("name","Roshan Basyal").put("avatarColor","#e7864a").put("choice","yes").put("createdAt","2026-07-22T12:00:00.000Z"))).put("options",new JSONArray()).put("winningOptions",new JSONArray().put("yes"));
        JSONObject group=new JSONObject().put("id","g1").put("name","Weekend Crew").put("emoji","⛰️").put("accent","#dc704b").put("role","admin").put("members",new JSONArray().put(user)).put("polls",new JSONArray().put(completed)).put("messages",new JSONArray());
        JSONObject notification=new JSONObject().put("id","n1").put("type","connection_accepted").put("title","Test notification").put("body","The native inbox is working.").put("entityId","u2").put("read",false).put("canClear",true).put("createdAt","2026-07-22T12:00:00.000Z");
        return new JSONObject().put("user",user).put("people",new JSONArray()).put("groups",new JSONArray().put(group)).put("groupInvites",new JSONArray()).put("payments",new JSONObject().put("incoming",new JSONArray()).put("outgoing",new JSONArray())).put("transactions",new JSONArray()).put("ledger",new JSONArray()).put("totals",new JSONObject().put("owedToYou",0).put("youOwe",0)).put("connections",new JSONArray()).put("connectionRequests",new JSONArray()).put("notifications",new JSONArray().put(notification)).put("calendarChoices",new JSONArray());
    }
}
