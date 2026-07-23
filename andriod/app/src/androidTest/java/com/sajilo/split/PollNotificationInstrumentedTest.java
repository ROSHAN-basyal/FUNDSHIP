package com.sajilo.split;

import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PollNotificationInstrumentedTest {
    @Test
    public void showsYesNoPollAlert() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        PollPayload payload=new PollPayload("notification-test-yes-no","Weekend Crew","🏕️","Should we leave at 7 AM?","Tomorrow","2083-04-07","7:00 AM",2,3,120,"yes_no",new JSONArray());
        assertTrue(PollNotificationManager.show(context,payload));
    }

    @Test
    public void showsOptionPollAlert() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();JSONArray options=new JSONArray();
        options.put(new JSONObject().put("id","option_1").put("label","Momo"));
        options.put(new JSONObject().put("id","option_2").put("label","Thakali"));
        options.put(new JSONObject().put("id","nota").put("label","NOTA"));
        PollPayload payload=new PollPayload("notification-test-options","Weekend Crew","🏕️","What should we eat?","Tomorrow","2083-04-07","6:00 PM",1,3,120,"options",options);
        assertTrue(PollNotificationManager.show(context,payload));
    }

    @Test
    public void clearsNotificationFixtures() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        PollNotificationManager.cancel(context,"notification-test-yes-no");
        PollNotificationManager.cancel(context,"notification-test-options");
        SharedPreferences prefs=context.getSharedPreferences("sajilo_poll_notifications",Context.MODE_PRIVATE);
        JSONArray existing=new JSONArray(prefs.getString("pending_actions","[]"));JSONArray clean=new JSONArray();
        for(int index=0;index<existing.length();index++){JSONObject item=existing.optJSONObject(index);if(item!=null&&!item.optString("pollId").startsWith("notification-test-"))clean.put(item);}
        prefs.edit().putString("pending_actions",clean.toString()).apply();
    }
}
