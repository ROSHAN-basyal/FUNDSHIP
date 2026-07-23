package com.sajilo.split;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.util.Locale;

public class PollAlertActivity extends AppCompatActivity {
    private PollPayload payload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        setContentView(R.layout.activity_poll_alert);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                PollNotificationManager.handleAction(PollAlertActivity.this, payload, PollNotificationManager.ACTION_LATER, false);
                finishAndRemoveTask();
            }
        });
        bindPayload();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        bindPayload();
    }

    private void bindPayload() {
        payload = PollPayload.fromIntent(getIntent());
        if (payload == null) { finish(); return; }
        ((TextView) findViewById(R.id.groupName)).setText(payload.groupEmoji + "  " + payload.groupName.toUpperCase(Locale.getDefault()));
        ((TextView) findViewById(R.id.pollTitle)).setText(payload.title);
        ((TextView) findViewById(R.id.eventWhen)).setText(payload.dateLabel + " · " + payload.timeLabel);
        ((TextView) findViewById(R.id.eventBsDate)).setText(payload.bsDate);

        boolean optionPoll = "options".equals(payload.pollType);
        ((TextView) findViewById(R.id.voteProgress)).setText(optionPoll
            ? payload.yesCount + " voted · " + payload.minYes + " votes needed"
            : payload.yesCount + " already said yes · " + payload.minYes + " needed to confirm");
        findViewById(R.id.yesNoActionsContainer).setVisibility(optionPoll ? View.GONE : View.VISIBLE);
        LinearLayout optionActions=findViewById(R.id.optionActionsContainer);optionActions.setVisibility(optionPoll?View.VISIBLE:View.GONE);optionActions.removeAllViews();
        if(optionPoll) buildOptionActions(optionActions);
        findViewById(R.id.yesButton).setOnClickListener(view -> submit(view, PollNotificationManager.ACTION_YES, null));
        findViewById(R.id.noButton).setOnClickListener(view -> submit(view, PollNotificationManager.ACTION_NO));
        findViewById(R.id.laterButton).setOnClickListener(view -> submit(view, PollNotificationManager.ACTION_LATER));
        findViewById(R.id.closeButton).setOnClickListener(view -> submit(view, PollNotificationManager.ACTION_LATER));
    }

    private void buildOptionActions(LinearLayout container){
        TextView instruction=NativeUi.text(this,"CHOOSE ONE OPTION",10,Color.rgb(191,208,203),true);instruction.setLetterSpacing(.1f);instruction.setGravity(android.view.Gravity.CENTER);container.addView(instruction,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,30)));
        for(JSONObject option:NativeUi.objects(payload.options)){
            String id=option.optString("id"),label=option.optString("label","Option");TextView choice=NativeUi.button(this,label,NativeUi.INK,Color.WHITE,13);choice.setTextSize(14);choice.setBackground(NativeUi.ripple(this,NativeUi.outlined(this,Color.WHITE,Color.rgb(112,151,141),13)));LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,NativeUi.dp(this,50));params.setMargins(0,NativeUi.dp(this,4),0,NativeUi.dp(this,4));container.addView(choice,params);choice.setOnClickListener(view->submit(view,PollNotificationManager.ACTION_OPTION,id));
        }
        TextView later=NativeUi.button(this,"Later · remind me in 2 hours",Color.rgb(207,222,217),Color.rgb(38,75,68),12);container.addView(later,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,48)));later.setOnClickListener(view->submit(view,PollNotificationManager.ACTION_LATER,null));
    }

    private void submit(View view, String action) {
        submit(view,action,null);
    }

    private void submit(View view, String action,String choice) {
        view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
        PollNotificationManager.handleAction(this, payload, action, choice, false, () -> {});
        finishAndRemoveTask();
    }
}
