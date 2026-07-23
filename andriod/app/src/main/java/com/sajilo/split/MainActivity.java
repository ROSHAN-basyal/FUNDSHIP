package com.sajilo.split;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.EditText;
import android.widget.CheckBox;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.recyclerview.widget.RecyclerView;
import androidx.viewpager2.widget.ViewPager2;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.text.SimpleDateFormat;
import java.util.concurrent.Executor;

public class MainActivity extends AppCompatActivity {
    private static final String PAYMENT_PREFS = "fundship_payment_handoff";
    private static final String PAYMENT_PACKAGE = "payment_package";
    private static final String PAYMENT_ACTIVITY = "payment_activity";
    private static final String PAYMENT_LABEL = "payment_label";
    private final FundsApi api = new FundsApi();
    private SecureSessionStore sessions;
    private FrameLayout root;
    private JSONObject data;
    private ViewPager2 pager;
    private PageAdapter pageAdapter;
    private LinearLayout bottomNav;
    private TextView bellBadge;
    private int currentPage;

    @Override protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        Window window=getWindow();WindowCompat.setDecorFitsSystemWindows(window,false);window.setStatusBarColor(Color.TRANSPARENT);window.setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat bars=WindowCompat.getInsetsController(window,window.getDecorView());bars.setAppearanceLightStatusBars(true);bars.setAppearanceLightNavigationBars(true);
        setContentView(R.layout.activity_main);root=findViewById(R.id.nativeRoot);root.setBackgroundColor(NativeUi.BG);
        ViewCompat.setOnApplyWindowInsetsListener(root,(view,insets)->{Insets system=insets.getInsets(WindowInsetsCompat.Type.systemBars());view.setPadding(0,system.top,0,system.bottom);return insets;});
        ViewCompat.requestApplyInsets(root);sessions=new SecureSessionStore(this);
        PollNotificationManager.createChannel(this);PaymentNotificationManager.createChannel(this);AppNotificationManager.createChannels(this);
        requestNotificationPermission();if(sessions.exists())restoreStoredSession();else showLogin();
    }

    @Override protected void onResume(){super.onResume();if(!api.token().isEmpty())consumePollActions();}

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!api.token().isEmpty()) loadBootstrap(false);
    }

    FundsApi api(){return api;}
    JSONObject data(){return data;}
    void toast(String value){Toast.makeText(this,value,Toast.LENGTH_SHORT).show();}
    void refresh(){loadBootstrap(false);}

    void payPerson(JSONObject person){
        String number=person.optString("phone").replaceAll("\\s+","");
        if(!number.matches("^9\\d{9}$")){toast(NativeUi.displayName(person.optString("name","This user"))+" has not added a valid payment number.");return;}
        Runnable handoff=()->copyAndOpenPaymentApp(number,person.optString("name","receiver"));
        if(hasPaymentApp())handoff.run();else choosePaymentApp(handoff);
    }

    private void copyAndOpenPaymentApp(String number,String receiver){
        ClipboardManager clipboard=(ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("FUNDSHIP payment number",number));
        android.content.SharedPreferences prefs=getSharedPreferences(PAYMENT_PREFS,MODE_PRIVATE);
        String packageName=prefs.getString(PAYMENT_PACKAGE,"");
        String activityName=prefs.getString(PAYMENT_ACTIVITY,"");
        Intent launch=null;
        if(!packageName.isEmpty()&&!activityName.isEmpty())launch=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(new ComponentName(packageName,activityName));
        if(launch==null||getPackageManager().resolveActivity(launch,0)==null)launch=packageName.isEmpty()?null:getPackageManager().getLaunchIntentForPackage(packageName);
        if(launch==null){clearPaymentApp();choosePaymentApp(()->copyAndOpenPaymentApp(number,receiver));return;}
        try{startActivity(launch);toast("Payment number copied for "+NativeUi.displayName(receiver));}
        catch(Exception ignored){clearPaymentApp();choosePaymentApp(()->copyAndOpenPaymentApp(number,receiver));}
    }

    private boolean hasPaymentApp(){
        android.content.SharedPreferences prefs=getSharedPreferences(PAYMENT_PREFS,MODE_PRIVATE);String packageName=prefs.getString(PAYMENT_PACKAGE,"");
        if(packageName.isEmpty())return false;
        String activityName=prefs.getString(PAYMENT_ACTIVITY,"");
        if(!activityName.isEmpty()){Intent exact=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(new ComponentName(packageName,activityName));if(getPackageManager().resolveActivity(exact,0)!=null)return true;}
        return getPackageManager().getLaunchIntentForPackage(packageName)!=null;
    }

    private String paymentAppName(){return getSharedPreferences(PAYMENT_PREFS,MODE_PRIVATE).getString(PAYMENT_LABEL,"");}
    private void clearPaymentApp(){getSharedPreferences(PAYMENT_PREFS,MODE_PRIVATE).edit().clear().apply();}

    private void choosePaymentApp(Runnable afterSelection){
        Intent launcherQuery=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> matches=getPackageManager().queryIntentActivities(launcherQuery,PackageManager.MATCH_ALL);
        Map<String,ResolveInfo> unique=new LinkedHashMap<>();
        for(ResolveInfo item:matches){if(item.activityInfo==null||getPackageName().equals(item.activityInfo.packageName))continue;unique.putIfAbsent(item.activityInfo.packageName,item);}
        List<ResolveInfo> apps=new ArrayList<>(unique.values());apps.sort(Comparator.comparing(item->String.valueOf(item.loadLabel(getPackageManager())),String.CASE_INSENSITIVE_ORDER));
        if(apps.isEmpty()){toast("No other launchable apps were found.");return;}
        LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);FundshipSheet[] sheetRef=new FundshipSheet[1];
        String selectedPackage=getSharedPreferences(PAYMENT_PREFS,MODE_PRIVATE).getString(PAYMENT_PACKAGE,"");
        for(ResolveInfo app:apps){String label=String.valueOf(app.loadLabel(getPackageManager()));String packageName=app.activityInfo.packageName;boolean selected=packageName.equals(selectedPackage);LinearLayout row=paymentAppRow(app,label,selected);content.addView(row,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,-2),0,0,0,8));row.setOnClickListener(v->{getSharedPreferences(PAYMENT_PREFS,MODE_PRIVATE).edit().putString(PAYMENT_PACKAGE,packageName).putString(PAYMENT_ACTIVITY,app.activityInfo.name).putString(PAYMENT_LABEL,label).apply();sheetRef[0].dismiss();toast(label+" selected for payments");if(afterSelection!=null)afterSelection.run();});}
        sheetRef[0]=FundshipSheet.show(this,"Installed on this phone","Choose payment app","FUNDSHIP will open this app after copying the receiver’s payment number.",content,null,92,null);
    }

    private LinearLayout paymentAppRow(ResolveInfo app,String label,boolean selected){
        LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(NativeUi.dp(this,10),NativeUi.dp(this,9),NativeUi.dp(this,10),NativeUi.dp(this,9));row.setBackground(NativeUi.ripple(this,NativeUi.outlined(this,selected?Color.rgb(248,252,249):Color.WHITE,selected?Color.rgb(184,212,203):NativeUi.LINE,13)));row.setContentDescription("Select "+label+" for payments");
        ImageView logo=new ImageView(this);logo.setImageDrawable(app.loadIcon(getPackageManager()));logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);logo.setPadding(NativeUi.dp(this,3),NativeUi.dp(this,3),NativeUi.dp(this,3),NativeUi.dp(this,3));logo.setBackground(NativeUi.shape(this,Color.rgb(247,247,243),11));row.addView(logo,new LinearLayout.LayoutParams(NativeUi.dp(this,46),NativeUi.dp(this,46)));
        LinearLayout words=new LinearLayout(this);words.setOrientation(LinearLayout.VERTICAL);words.setGravity(Gravity.CENTER_VERTICAL);words.addView(NativeUi.text(this,label,14,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,24)));words.addView(NativeUi.text(this,selected?"Currently selected":app.activityInfo.packageName,10,selected?NativeUi.GREEN:NativeUi.MUTED,false),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,18)));row.addView(words,NativeUi.margins(this,new LinearLayout.LayoutParams(0,-2,1),11,0,8,0));
        TextView state=NativeUi.text(this,selected?"✓":"›",selected?16:22,selected?NativeUi.GREEN:NativeUi.MUTED,true);state.setGravity(Gravity.CENTER);if(selected)state.setBackground(NativeUi.shape(this,NativeUi.GREEN_SOFT,16));row.addView(state,new LinearLayout.LayoutParams(NativeUi.dp(this,34),NativeUi.dp(this,34)));return row;
    }

    private void requestNotificationPermission(){if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)ActivityCompat.requestPermissions(this,new String[]{Manifest.permission.POST_NOTIFICATIONS},40);}

    private void showLogin(){
        root.removeAllViews();root.setBackgroundColor(NativeUi.INK);WindowCompat.getInsetsController(getWindow(),getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setBackgroundColor(NativeUi.INK);
        LinearLayout brand=new LinearLayout(this);brand.setOrientation(LinearLayout.VERTICAL);brand.setGravity(Gravity.CENTER_VERTICAL);brand.setPadding(NativeUi.dp(this,28),NativeUi.dp(this,18),NativeUi.dp(this,28),NativeUi.dp(this,16));TextView logo=NativeUi.text(this,"F",25,Color.WHITE,true);logo.setGravity(Gravity.CENTER);logo.setBackground(NativeUi.shape(this,NativeUi.ORANGE,15));brand.addView(logo,new LinearLayout.LayoutParams(NativeUi.dp(this,50),NativeUi.dp(this,50)));TextView name=NativeUi.text(this,"FUNDSHIP",38,Color.WHITE,true);brand.addView(name,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,54)),0,13,0,0));TextView copy=NativeUi.text(this,"Plans, payments and friends—together.",13,Color.rgb(207,222,217),false);brand.addView(copy,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,32)));page.addView(brand,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,236)));
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackground(NativeUi.topRounded(this,NativeUi.BG,24));LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(NativeUi.dp(this,25),NativeUi.dp(this,30),NativeUi.dp(this,25),NativeUi.dp(this,34));scroll.addView(content);
        content.addView(NativeUi.text(this,"Welcome back",25,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,38)));content.addView(NativeUi.text(this,"Use your system-issued ID to continue.",12,NativeUi.MUTED,false),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,34)));
        TextView idLabel=NativeUi.text(this,"USER ID",10,NativeUi.INK_2,true);idLabel.setLetterSpacing(.1f);content.addView(idLabel,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,24)),0,18,0,0));
        EditText id=input("System-issued user ID");id.setText(sessions.exists()?sessions.credentialId():"RB-001");id.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);content.addView(id,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,54)));
        TextView passwordLabel=NativeUi.text(this,"PASSWORD",10,NativeUi.INK_2,true);passwordLabel.setLetterSpacing(.1f);content.addView(passwordLabel,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,24)),0,13,0,0));
        EditText password=input("Password");password.setText(sessions.exists()?"":"12345678");password.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);content.addView(password,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,54)));
        TextView signIn=NativeUi.button(this,"Sign in",Color.WHITE,NativeUi.ORANGE,14);NativeUi.elevate(signIn,4);content.addView(signIn,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,55)),0,18,0,0));
        signIn.setOnClickListener(view->{String user=id.getText().toString().trim(),pass=password.getText().toString();if(user.isEmpty()||pass.isEmpty()){toast("Enter your ID and password.");return;}setBusy(signIn,true,"Signing in…");api.login(user,pass,new FundsApi.Callback(){public void success(JSONObject response){String token=response.optString("token");api.setToken(token);JSONObject account=response.optJSONObject("user");rememberSession(token,account==null?user:account.optString("credentialId",user));loadBootstrap(true);}public void error(String message){setBusy(signIn,false,"Sign in");toast(message);}});});
        TextView note=NativeUi.text(this,"Your account ID is issued by the FUNDSHIP administrator.",10,NativeUi.MUTED,false);note.setGravity(Gravity.CENTER);content.addView(note,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,42)),0,18,0,0));page.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));root.addView(page,new FrameLayout.LayoutParams(-1,-1));
    }

    private EditText input(String hint){EditText input=new EditText(this);input.setHint(hint);input.setTextColor(NativeUi.INK);input.setHintTextColor(Color.rgb(145,153,149));input.setTextSize(15);input.setSingleLine(true);input.setPadding(NativeUi.dp(this,14),0,NativeUi.dp(this,14),0);input.setBackground(NativeUi.outlined(this,Color.WHITE,NativeUi.LINE,13));return input;}
    private void setBusy(TextView button,boolean busy,String text){button.setEnabled(!busy);button.setAlpha(busy?.65f:1f);button.setText(text);}

    private void restoreStoredSession(){try{api.setToken(sessions.load());loadBootstrap(true);}catch(Exception error){api.clearToken();sessions.clear();showLogin();toast("Saved sign-in could not be restored. Use your password.");}}
    private void rememberSession(String token,String id){try{sessions.save(token,id);}catch(Exception ignored){toast("Signed in, but this phone could not remember the session.");}}

    void authenticate(String title,String subtitle,String fallback,Runnable success,Runnable cancelled){
        if(BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)!=BiometricManager.BIOMETRIC_SUCCESS){cancelled.run();return;}
        Executor executor=ContextCompat.getMainExecutor(this);BiometricPrompt prompt=new BiometricPrompt(this,executor,new BiometricPrompt.AuthenticationCallback(){@Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result){success.run();}@Override public void onAuthenticationError(int code,@NonNull CharSequence message){cancelled.run();}});
        prompt.authenticate(new BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(subtitle).setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK).setNegativeButtonText(fallback).setConfirmationRequired(false).build());
    }

    void verifySensitiveAction(String title,String subtitle,Runnable success){authenticate(title,subtitle,"Use MPIN",success,()->showSensitiveMpin(title,success));}
    private void showSensitiveMpin(String title,Runnable success){LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);EditText mpin=NativeUi.input(this,"4-digit MPIN",true);mpin.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_VARIATION_PASSWORD);form.addView(NativeUi.labeled(this,"MPIN",mpin,"Fingerprint was cancelled or unavailable."),new LinearLayout.LayoutParams(-1,-2));FundshipSheet.show(this,"Security check",title,"Confirm this action with your FUNDSHIP MPIN.",form,"Verify",66,sheet->{String value=mpin.getText().toString();if(!value.matches("^\\d{4}$")){mpin.setError("Enter your 4-digit MPIN");return;}sheet.setBusy(true,"Verifying…","Verify");JSONObject body=new JSONObject();try{body.put("mpin",value);}catch(Exception ignored){}api.post("/auth/verify-mpin",body,new FundsApi.Callback(){public void success(JSONObject ignored){sheet.dismiss();success.run();}public void error(String message){sheet.setBusy(false,"","Verify");toast(message);}});});}

    private void loadBootstrap(boolean showLoading){if(showLoading)showLoading();api.bootstrap(new FundsApi.Callback(){public void success(JSONObject response){data=response;buildShell();ensureFullScreenPollAccess();deliverNotifications();}public void error(String message){if(message.toLowerCase(Locale.ROOT).contains("session")){api.clearToken();sessions.clear();showLogin();}else{showLogin();toast("Failed to fetch: "+message);}}});}
    private void showLoading(){root.removeAllViews();root.setBackgroundColor(NativeUi.INK);WindowCompat.getInsetsController(getWindow(),getWindow().getDecorView()).setAppearanceLightStatusBars(false);LinearLayout box=new LinearLayout(this);box.setGravity(Gravity.CENTER);box.setOrientation(LinearLayout.VERTICAL);box.setBackgroundColor(NativeUi.INK);TextView mark=NativeUi.text(this,"F",25,Color.WHITE,true);mark.setGravity(Gravity.CENTER);mark.setBackground(NativeUi.shape(this,NativeUi.ORANGE,20));box.addView(mark,new LinearLayout.LayoutParams(NativeUi.dp(this,68),NativeUi.dp(this,68)));TextView label=NativeUi.text(this,"FUNDSHIP",18,Color.WHITE,true);box.addView(label,NativeUi.margins(this,new LinearLayout.LayoutParams(-2,NativeUi.dp(this,40)),0,13,0,0));root.addView(box,new FrameLayout.LayoutParams(-1,-1));}

    private void ensureFullScreenPollAccess(){
        if(Build.VERSION.SDK_INT<34||PollNotificationManager.canUseFullScreenIntent(this))return;
        if(getPreferences(MODE_PRIVATE).getBoolean("full_screen_prompted",false))return;
        getPreferences(MODE_PRIVATE).edit().putBoolean("full_screen_prompted",true).apply();
        LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);LinearLayout note=NativeUi.sectionCard(this);TextView copy=NativeUi.text(this,"Full-screen access lets an incoming poll wake the screen and appear over the lock screen. You can change this later in Android settings.",13,NativeUi.INK,false);copy.setLineSpacing(0,1.15f);note.addView(copy,new LinearLayout.LayoutParams(-1,-2));content.addView(note);
        FundshipSheet.show(this,"Notification access","Allow poll alerts","Required for time-sensitive incoming poll screens.",content,"Open Android settings",68,sheet->{sheet.dismiss();try{startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:"+getPackageName())));}catch(Exception ignored){startActivity(PollNotificationManager.notificationSettingsIntent(this));}});
    }

    private void buildShell(){
        int selected=currentPage;root.removeAllViews();root.setBackgroundColor(NativeUi.BG);WindowCompat.getInsetsController(getWindow(),getWindow().getDecorView()).setAppearanceLightStatusBars(true);LinearLayout shell=new LinearLayout(this);shell.setOrientation(LinearLayout.VERTICAL);shell.setBackgroundColor(NativeUi.BG);
        shell.addView(buildToolbar(),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,62)));
        pager=new ViewPager2(this);pager.setOrientation(ViewPager2.ORIENTATION_HORIZONTAL);pager.setClipToPadding(false);pager.setClipChildren(true);pager.setOffscreenPageLimit(1);pageAdapter=new PageAdapter();pager.setAdapter(pageAdapter);pager.setPageTransformer((page,position)->page.setAlpha(.76f+.24f*Math.max(0f,1f-Math.abs(position))));
        shell.addView(pager,new LinearLayout.LayoutParams(-1,0,1));bottomNav=new LinearLayout(this);bottomNav.setGravity(Gravity.CENTER);bottomNav.setWeightSum(5);bottomNav.setBackgroundColor(NativeUi.PAPER);NativeUi.elevate(bottomNav,8);shell.addView(bottomNav,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,68)));root.addView(shell,new FrameLayout.LayoutParams(-1,-1));
        rebuildBottomNav();pager.registerOnPageChangeCallback(new ViewPager2.OnPageChangeCallback(){@Override public void onPageSelected(int position){currentPage=position;rebuildBottomNav();}});pager.setCurrentItem(Math.min(selected,pageAdapter.getItemCount()-1),false);
    }

    private View buildToolbar(){
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(NativeUi.dp(this,15),0,NativeUi.dp(this,10),0);bar.setBackgroundColor(NativeUi.PAPER);NativeUi.elevate(bar,2);
        TextView mark=NativeUi.text(this,"F",17,Color.WHITE,true);mark.setGravity(Gravity.CENTER);mark.setBackground(NativeUi.shape(this,NativeUi.INK,11));bar.addView(mark,new LinearLayout.LayoutParams(NativeUi.dp(this,34),NativeUi.dp(this,34)));
        TextView title=NativeUi.text(this,"FUNDSHIP",18,NativeUi.INK,true);bar.addView(title,NativeUi.margins(this,new LinearLayout.LayoutParams(0,-1,1),10,0,0,0));
        int unread=0;JSONArray notifications=data.optJSONArray("notifications");for(JSONObject item:NativeUi.objects(notifications))if(!item.optBoolean("read"))unread++;
        FrameLayout bell=new FrameLayout(this);bell.setClickable(true);bell.setFocusable(true);bell.setContentDescription("Open notifications");bell.setBackground(NativeUi.ripple(this,NativeUi.outlined(this,Color.WHITE,NativeUi.LINE,11)));ImageView bellIcon=NativeUi.icon(this,R.drawable.ic_bell_outline,NativeUi.INK,9);bellIcon.setClickable(false);bellIcon.setFocusable(false);bell.addView(bellIcon,new FrameLayout.LayoutParams(-1,-1));bellBadge=NativeUi.text(this,unread>0?String.valueOf(Math.min(99,unread)):"",8,Color.WHITE,true);bellBadge.setGravity(Gravity.CENTER);bellBadge.setBackground(NativeUi.shape(this,NativeUi.ORANGE,8));FrameLayout.LayoutParams badgeParams=new FrameLayout.LayoutParams(NativeUi.dp(this,16),NativeUi.dp(this,16),Gravity.END|Gravity.TOP);badgeParams.setMargins(0,-NativeUi.dp(this,2),-NativeUi.dp(this,2),0);bell.addView(bellBadge,badgeParams);bellBadge.setVisibility(unread>0?View.VISIBLE:View.GONE);bar.addView(bell,new LinearLayout.LayoutParams(NativeUi.dp(this,38),NativeUi.dp(this,38)));bell.setOnClickListener(view->showNotifications());
        JSONObject user=data.optJSONObject("user");TextView avatar=NativeUi.avatar(this,user==null?"User":user.optString("name"),user==null?"#E7864A":user.optString("avatarColor"),34);bar.addView(avatar,NativeUi.margins(this,new LinearLayout.LayoutParams(NativeUi.dp(this,34),NativeUi.dp(this,34)),9,0,0,0));avatar.setOnClickListener(view->showProfile());
        return bar;
    }

    private void rebuildBottomNav(){if(bottomNav==null)return;bottomNav.removeAllViews();addNav(R.drawable.ic_home_outline,null,"Home",0);JSONArray groups=data.optJSONArray("groups");int shown=Math.min(3,groups==null?0:groups.length());for(int index=0;index<shown;index++){JSONObject group=groups.optJSONObject(index);addNav(0,group.optString("emoji","●"),first(group.optString("name")),index+1);}addNav(R.drawable.ic_groups_outline,null,"Groups",-1);}
    private void addNav(int drawable,String emoji,String label,int page){LinearLayout item=new LinearLayout(this);item.setOrientation(LinearLayout.VERTICAL);item.setGravity(Gravity.CENTER_HORIZONTAL);boolean active=page==currentPage;View indicator=new View(this);indicator.setBackgroundColor(active?NativeUi.ORANGE:Color.TRANSPARENT);item.addView(indicator,new LinearLayout.LayoutParams(NativeUi.dp(this,28),NativeUi.dp(this,2)));if(drawable!=0){ImageView symbol=NativeUi.icon(this,drawable,active?NativeUi.INK:NativeUi.MUTED,6);item.addView(symbol,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,36)));}else{TextView symbol=NativeUi.text(this,emoji,19,NativeUi.INK,false);symbol.setGravity(Gravity.CENTER);item.addView(symbol,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,36)));}TextView name=NativeUi.text(this,label,10,active?NativeUi.INK:NativeUi.MUTED,active);name.setGravity(Gravity.TOP|Gravity.CENTER_HORIZONTAL);item.addView(name,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,24)));bottomNav.addView(item,new LinearLayout.LayoutParams(0,-1,1));item.setOnClickListener(view->{if(page>=0)pager.setCurrentItem(page,true);else showGroups();});}
    private String first(String name){String[] parts=name.split(" ");return parts.length==0?name:parts[0];}

    private final class PageAdapter extends RecyclerView.Adapter<PageAdapter.Holder>{
        final class Holder extends RecyclerView.ViewHolder{final FrameLayout frame;Holder(FrameLayout value){super(value);frame=value;}}
        @NonNull @Override public Holder onCreateViewHolder(@NonNull ViewGroup parent,int type){FrameLayout frame=new FrameLayout(MainActivity.this);frame.setLayoutParams(new ViewGroup.LayoutParams(-1,-1));frame.setClipChildren(true);return new Holder(frame);}
        @Override public void onBindViewHolder(@NonNull Holder holder,int position){holder.frame.removeAllViews();View page=position==0?new HomePageView(MainActivity.this,MainActivity.this):new GroupPageView(MainActivity.this,MainActivity.this,data.optJSONArray("groups").optJSONObject(position-1));holder.frame.addView(page,new FrameLayout.LayoutParams(-1,-1));}
        @Override public int getItemCount(){JSONArray groups=data.optJSONArray("groups");return 1+(groups==null?0:groups.length());}
    }

    private void showNotifications(){
        JSONArray items=data.optJSONArray("notifications");LinearLayout content=dialogList();FundshipSheet[] sheetRef=new FundshipSheet[1];if(items==null||items.length()==0){LinearLayout empty=NativeUi.sectionCard(this);empty.setGravity(Gravity.CENTER);TextView emptyTitle=NativeUi.text(this,"You’re all caught up",16,NativeUi.INK,true);emptyTitle.setGravity(Gravity.CENTER);empty.addView(emptyTitle,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,38)));TextView emptyCopy=NativeUi.text(this,"Payment, poll, group and connection updates will appear here.",12,NativeUi.MUTED,false);emptyCopy.setGravity(Gravity.CENTER);emptyCopy.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);empty.addView(emptyCopy,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,54)));content.addView(empty,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,122)));}
        else for(JSONObject item:NativeUi.objects(items)){
            LinearLayout row=simpleRow(iconFor(item.optString("type")),item.optString("title"),item.optString("body")+" · "+NativeUi.relative(item.optString("createdAt")));if(!item.optBoolean("read"))row.setBackground(NativeUi.outlined(this,Color.rgb(248,252,249),Color.rgb(190,218,209),12));content.addView(row,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,-2),0,0,0,8));row.setOnClickListener(v->{sheetRef[0].dismiss();openNotification(item);});
            if("connection_request".equals(item.optString("type"))){JSONObject request=findById(data.optJSONArray("connectionRequests"),item.optString("entityId"));if(request!=null&&!request.optBoolean("outgoing")){TextView decline=NativeUi.button(this,"✕",NativeUi.RED,NativeUi.RED_SOFT,9),accept=NativeUi.button(this,"✓",Color.WHITE,NativeUi.GREEN,9);row.addView(decline,new LinearLayout.LayoutParams(NativeUi.dp(this,40),NativeUi.dp(this,36)));row.addView(accept,NativeUi.margins(this,new LinearLayout.LayoutParams(NativeUi.dp(this,40),NativeUi.dp(this,36)),5,0,0,0));decline.setOnClickListener(v->{sheetRef[0].dismiss();respondConnection(request.optString("id"),false);});accept.setOnClickListener(v->{sheetRef[0].dismiss();respondConnection(request.optString("id"),true);});continue;}}
            if(item.optBoolean("canClear")){TextView clear=NativeUi.button(this,"Clear",NativeUi.RED,NativeUi.RED_SOFT,9);row.addView(clear,new LinearLayout.LayoutParams(NativeUi.dp(this,64),NativeUi.dp(this,36)));clear.setOnClickListener(v->{sheetRef[0].dismiss();api.delete("/notifications/"+item.optString("id"),callbackRefresh("Notification cleared"));});}
        }
        int count=items==null?0:items.length();sheetRef[0]=FundshipSheet.show(this,"Activity","Notifications",count==0?"Nothing needs your attention.":count+" update"+(count==1?"":"s")+" in your inbox.",content,null,90,null);if(count>0)api.post("/notifications/read",new JSONObject(),new FundsApi.Callback(){public void success(JSONObject response){data=response;updateBell();}public void error(String ignored){}});
    }

    private void openNotification(JSONObject item){String type=item.optString("type");if("payment_request".equals(type)){pager.setCurrentItem(0,true);return;}if("group_invite".equals(type)){showGroups();return;}JSONArray groups=data.optJSONArray("groups");for(int index=0;groups!=null&&index<groups.length();index++){JSONObject group=groups.optJSONObject(index);for(JSONObject poll:NativeUi.objects(group.optJSONArray("polls")))if(item.optString("entityId").equals(poll.optString("id"))){pager.setCurrentItem(index+1,true);return;}}}

    private String iconFor(String type){if(type.contains("payment"))return "रु";if(type.contains("connection"))return "↔";if(type.contains("event"))return "◷";return "🔔";}
    private void updateBell(){if(bellBadge==null)return;int unread=0;for(JSONObject item:NativeUi.objects(data.optJSONArray("notifications")))if(!item.optBoolean("read"))unread++;bellBadge.setText(String.valueOf(Math.min(99,unread)));bellBadge.setVisibility(unread>0?View.VISIBLE:View.GONE);}

    private void showProfile(){
        JSONObject user=data.optJSONObject("user");if(user==null)return;
        LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(0,0,0,NativeUi.dp(this,14));
        FundshipSheet[] sheetRef=new FundshipSheet[1];

        LinearLayout identity=NativeUi.sectionCard(this);identity.setGravity(Gravity.CENTER_VERTICAL);identity.setOrientation(LinearLayout.HORIZONTAL);identity.setPadding(NativeUi.dp(this,14),NativeUi.dp(this,14),NativeUi.dp(this,14),NativeUi.dp(this,14));
        TextView largeAvatar=NativeUi.avatar(this,user.optString("name","User"),user.optString("avatarColor","#E7864A"),58);identity.addView(largeAvatar,new LinearLayout.LayoutParams(NativeUi.dp(this,58),NativeUi.dp(this,58)));
        LinearLayout identityWords=new LinearLayout(this);identityWords.setOrientation(LinearLayout.VERTICAL);identityWords.setGravity(Gravity.CENTER_VERTICAL);identityWords.addView(NativeUi.text(this,user.optString("name"),18,NativeUi.INK,true),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,29)));identityWords.addView(NativeUi.text(this,user.optString("credentialId"),12,NativeUi.GREEN,true),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,23)));String phone=user.optString("phone");identityWords.addView(NativeUi.text(this,phone.isEmpty()?"Payment number not added":phone+" · payment number",10,NativeUi.MUTED,false),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,21)));identity.addView(identityWords,NativeUi.margins(this,new LinearLayout.LayoutParams(0,-1,1),13,0,0,0));content.addView(identity,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,88)));

        content.addView(sheetSection("Payment setup",-1),NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,38)),0,20,0,0));
        EditText paymentNumber=NativeUi.input(this,"98XXXXXXXX",true);paymentNumber.setInputType(InputType.TYPE_CLASS_PHONE);paymentNumber.setText(phone);paymentNumber.setSelection(paymentNumber.length());
        content.addView(NativeUi.labeled(this,"Your payment phone number",paymentNumber,"People will copy this number when they pay you."),new LinearLayout.LayoutParams(-1,-2));
        TextView saveNumber=NativeUi.button(this,"Save payment number",Color.WHITE,NativeUi.GREEN,12);content.addView(saveNumber,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,50)),0,10,0,0));
        saveNumber.setOnClickListener(v->{String clean=paymentNumber.getText().toString().replaceAll("\\D","");if(!clean.matches("^9\\d{9}$")){paymentNumber.setError("Enter a valid 10-digit mobile number");paymentNumber.requestFocus();return;}JSONObject body=new JSONObject();try{body.put("phone",clean);if(user.has("profilePhoto"))body.put("profilePhoto",user.optString("profilePhoto"));if(user.has("paymentQr"))body.put("paymentQr",user.optString("paymentQr"));else if(user.has("esewaQr"))body.put("paymentQr",user.optString("esewaQr"));}catch(Exception ignored){}sheetRef[0].dismiss();api.post("/profile",body,callbackRefresh("Payment number saved"));});

        String chosen=paymentAppName();TextView chooseApp=NativeUi.button(this,chosen.isEmpty()?"Choose wallet or banking app":"Payment app · "+chosen,NativeUi.INK,Color.WHITE,12);chooseApp.setGravity(Gravity.CENTER_VERTICAL);chooseApp.setBackground(NativeUi.ripple(this,NativeUi.outlined(this,Color.WHITE,NativeUi.LINE,12)));content.addView(chooseApp,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,52)),0,10,0,0));TextView appHelp=NativeUi.text(this,"This preference stays on this phone. FUNDSHIP only opens the app; it never controls it.",10,NativeUi.MUTED,false);appHelp.setLineSpacing(0,1.08f);content.addView(appHelp,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,36)));chooseApp.setOnClickListener(v->{sheetRef[0].dismiss();choosePaymentApp(this::showProfile);});

        TextView connectionTitle=sheetSection("Connections",data.optJSONArray("connections").length());content.addView(connectionTitle,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,38)),0,20,0,0));
        EditText id=NativeUi.input(this,"System-issued user ID",false);LinearLayout connectRow=new LinearLayout(this);connectRow.addView(id,new LinearLayout.LayoutParams(0,NativeUi.dp(this,52),1));TextView connect=NativeUi.button(this,"Connect",Color.WHITE,NativeUi.INK,12);connectRow.addView(connect,NativeUi.margins(this,new LinearLayout.LayoutParams(NativeUi.dp(this,96),NativeUi.dp(this,52)),8,0,0,0));content.addView(connectRow,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,52)));
        TextView connectionHelp=NativeUi.text(this,"Enter a username to send a connection request.",10,NativeUi.MUTED,false);content.addView(connectionHelp,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,30)),2,5,0,0));

        connect.setOnClickListener(v->{String credential=id.getText().toString().trim();if(credential.isEmpty()){id.setError("Enter a user ID");return;}JSONObject body=new JSONObject();try{body.put("credentialId",credential);}catch(Exception ignored){}sheetRef[0].dismiss();api.post("/connections/request",body,callbackRefresh("Connection request sent"));});

        JSONArray requests=data.optJSONArray("connectionRequests");if(requests!=null&&requests.length()>0){content.addView(sheetSection("Pending requests",requests.length()),new LinearLayout.LayoutParams(-1,NativeUi.dp(this,42)));for(JSONObject request:NativeUi.objects(requests)){JSONObject person=request.optJSONObject("requester");if(person==null)continue;LinearLayout row=simpleRow("↔",person.optString("name"),request.optBoolean("outgoing")?"Waiting for a response":person.optString("credentialId"));content.addView(row,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,-2),0,0,0,8));if(!request.optBoolean("outgoing")){TextView decline=NativeUi.button(this,"×",NativeUi.RED,NativeUi.RED_SOFT,10);TextView accept=NativeUi.button(this,"✓",Color.WHITE,NativeUi.GREEN,10);row.addView(decline,new LinearLayout.LayoutParams(NativeUi.dp(this,38),NativeUi.dp(this,38)));row.addView(accept,NativeUi.margins(this,new LinearLayout.LayoutParams(NativeUi.dp(this,38),NativeUi.dp(this,38)),5,0,0,0));decline.setOnClickListener(v->{sheetRef[0].dismiss();respondConnection(request.optString("id"),false);});accept.setOnClickListener(v->{sheetRef[0].dismiss();respondConnection(request.optString("id"),true);});}}}

        JSONArray connections=data.optJSONArray("connections");if(connections==null||connections.length()==0){LinearLayout empty=NativeUi.sectionCard(this);TextView emptyText=NativeUi.text(this,"No connections yet. Enter a user ID above to connect.",12,NativeUi.MUTED,false);emptyText.setGravity(Gravity.CENTER);empty.addView(emptyText,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,62)));content.addView(empty,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,88)));}else for(JSONObject person:NativeUi.objects(connections))content.addView(simpleRow("✓",person.optString("name"),person.optString("credentialId")+" · Connected"),NativeUi.margins(this,new LinearLayout.LayoutParams(-1,-2),0,0,0,8));

        TextView signOut=NativeUi.button(this,"Sign out",NativeUi.RED,Color.WHITE,12);signOut.setBackground(NativeUi.ripple(this,NativeUi.outlined(this,Color.WHITE,Color.rgb(236,196,190),12)));content.addView(signOut,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,50)),0,20,0,0));signOut.setOnClickListener(v->{sheetRef[0].dismiss();api.clearToken();sessions.clear();showLogin();});
        sheetRef[0]=FundshipSheet.show(this,"Your account","Profile","Manage your payment handoff and connections.",content,null,92,null);
    }

    private void respondConnection(String id,boolean accept){if(accept){verifySensitiveAction("Accept connection","Confirm before adding this person to your payment connections.",()->submitConnectionResponse(id,true));return;}submitConnectionResponse(id,false);}
    private void submitConnectionResponse(String id,boolean accept){JSONObject body=new JSONObject();try{body.put("accept",accept);}catch(Exception ignored){}api.post("/connections/"+id.replace(":","%3A")+"/respond",body,callbackRefresh(accept?"Connection accepted":"Connection declined"));}

    private void showGroups(){
        LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(0,0,0,NativeUi.dp(this,14));
        TextView create=NativeUi.button(this,"＋  Create a new group",Color.WHITE,NativeUi.INK,14);NativeUi.elevate(create,3);content.addView(create,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,54)));
        JSONArray invites=data.optJSONArray("groupInvites");JSONArray groups=data.optJSONArray("groups");FundshipSheet[] sheetRef=new FundshipSheet[1];create.setOnClickListener(v->{sheetRef[0].dismiss();createGroup();});
        if(invites!=null&&invites.length()>0){content.addView(sheetSection("Invitations",invites.length()),NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,43)),0,17,0,0));for(JSONObject invite:NativeUi.objects(invites)){LinearLayout row=simpleRow(invite.optString("emoji"),invite.optString("groupName"),"Invited by "+invite.optString("inviterName"));content.addView(row,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,-2),0,0,0,8));TextView decline=NativeUi.button(this,"×",NativeUi.RED,NativeUi.RED_SOFT,9),accept=NativeUi.button(this,"Join",Color.WHITE,NativeUi.GREEN,9);row.addView(decline,new LinearLayout.LayoutParams(NativeUi.dp(this,38),NativeUi.dp(this,38)));row.addView(accept,NativeUi.margins(this,new LinearLayout.LayoutParams(NativeUi.dp(this,58),NativeUi.dp(this,38)),5,0,0,0));decline.setOnClickListener(v->{sheetRef[0].dismiss();respondInvite(invite.optString("id"),false);});accept.setOnClickListener(v->{sheetRef[0].dismiss();respondInvite(invite.optString("id"),true);});}}
        content.addView(sheetSection("Your groups",groups==null?0:groups.length()),NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,43)),0,17,0,0));
        if(groups==null||groups.length()==0){LinearLayout empty=NativeUi.sectionCard(this);TextView message=NativeUi.text(this,"Create a group to start planning together.",12,NativeUi.MUTED,false);message.setGravity(Gravity.CENTER);empty.addView(message,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,64)));content.addView(empty);}else for(int index=0;index<groups.length();index++){JSONObject group=groups.optJSONObject(index);LinearLayout row=simpleRow(group.optString("emoji","👥"),group.optString("name"),group.optJSONArray("members").length()+" members · "+("admin".equals(group.optString("role"))?"Admin":"Member"));TextView next=NativeUi.text(this,"›",23,NativeUi.MUTED,false);next.setGravity(Gravity.CENTER);row.addView(next,new LinearLayout.LayoutParams(NativeUi.dp(this,30),NativeUi.dp(this,40)));content.addView(row,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,-2),0,0,0,8));int page=index+1;row.setOnClickListener(v->{sheetRef[0].dismiss();pager.setCurrentItem(page,true);});}
        sheetRef[0]=FundshipSheet.show(this,"Plan together","Groups","Create a group, respond to invitations, or open an existing group.",content,null,90,null);
    }

    private void createGroup(){
        LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(0,0,0,NativeUi.dp(this,12));
        EditText name=NativeUi.input(this,"e.g. Weekend Crew",false);form.addView(NativeUi.labeled(this,"Group name",name,"Use a name everyone will recognize."),new LinearLayout.LayoutParams(-1,-2));
        form.addView(NativeUi.fieldLabel(this,"Group icon"),NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,27)),0,18,0,0));
        LinearLayout emojiRow=new LinearLayout(this);String[] emojis={"👥","🎉","🏕️","⚽","🍽️","✈️"};String[] selected={emojis[0]};List<TextView> emojiViews=new ArrayList<>();for(String emoji:emojis){TextView chip=NativeUi.button(this,emoji,NativeUi.INK,Color.WHITE,13);chip.setTextSize(20);emojiRow.addView(chip,NativeUi.margins(this,new LinearLayout.LayoutParams(0,NativeUi.dp(this,48),1),emoji.equals(emojis[0])?0:3,0,emoji.equals(emojis[emojis.length-1])?0:3,0));emojiViews.add(chip);chip.setOnClickListener(v->{selected[0]=emoji;for(int i=0;i<emojiViews.size();i++){boolean active=emojis[i].equals(selected[0]);emojiViews.get(i).setBackground(NativeUi.ripple(this,NativeUi.outlined(this,active?NativeUi.GREEN_SOFT:Color.WHITE,active?NativeUi.GREEN:NativeUi.LINE,13)));}});}for(int i=0;i<emojiViews.size();i++){boolean active=i==0;emojiViews.get(i).setBackground(NativeUi.ripple(this,NativeUi.outlined(this,active?NativeUi.GREEN_SOFT:Color.WHITE,active?NativeUi.GREEN:NativeUi.LINE,13)));}form.addView(emojiRow,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,48)));

        JSONArray connections=data.optJSONArray("connections");form.addView(sheetSection("Invite connections",connections==null?0:connections.length()),NativeUi.margins(this,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,43)),0,19,0,0));List<CheckBox> inviteChecks=new ArrayList<>();List<JSONObject> invitePeople=NativeUi.objects(connections);if(invitePeople.isEmpty()){LinearLayout empty=NativeUi.sectionCard(this);TextView message=NativeUi.text(this,"No connections yet. You can create the group now and invite people later.",12,NativeUi.MUTED,false);message.setGravity(Gravity.CENTER_VERTICAL);empty.addView(message,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,62)));form.addView(empty,new LinearLayout.LayoutParams(-1,NativeUi.dp(this,88)));}else for(JSONObject person:invitePeople){LinearLayout row=simpleRow("＋",person.optString("name"),person.optString("credentialId"));CheckBox check=new CheckBox(this);check.setContentDescription("Invite "+person.optString("name"));row.addView(check,new LinearLayout.LayoutParams(NativeUi.dp(this,44),NativeUi.dp(this,44)));row.setOnClickListener(v->check.setChecked(!check.isChecked()));form.addView(row,NativeUi.margins(this,new LinearLayout.LayoutParams(-1,-2),0,0,0,8));inviteChecks.add(check);}

        FundshipSheet.show(this,"New circle","Create group","Choose a name, icon, and the people you want to invite.",form,"Create group",91,sheet->{String clean=name.getText().toString().trim();if(clean.length()<2){name.setError("Give your group a name");name.requestFocus();return;}JSONArray inviteeIds=new JSONArray();for(int i=0;i<inviteChecks.size();i++)if(inviteChecks.get(i).isChecked())inviteeIds.put(invitePeople.get(i).optString("id"));JSONObject body=new JSONObject();try{body.put("name",clean);body.put("emoji",selected[0]);body.put("inviteeIds",inviteeIds);}catch(Exception ignored){}sheet.setBusy(true,"Creating group…","Create group");sheet.dismiss();api.post("/groups",body,callbackRefresh(inviteeIds.length()>0?"Group created · invitations sent":"Group created"));});
    }
    private void respondInvite(String id,boolean accept){if(accept){verifySensitiveAction("Join group","Confirm before joining this group and connecting with its members.",()->submitInviteResponse(id,true));return;}submitInviteResponse(id,false);}
    private void submitInviteResponse(String id,boolean accept){JSONObject body=new JSONObject();try{body.put("accept",accept);}catch(Exception ignored){}api.post("/group-invites/"+id+"/respond",body,callbackRefresh(accept?"Group joined":"Invitation declined"));}

    private LinearLayout dialogList(){LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(NativeUi.dp(this,8),NativeUi.dp(this,8),NativeUi.dp(this,8),NativeUi.dp(this,8));return content;}
    private ScrollView wrapDialog(View view){ScrollView scroll=new ScrollView(this);scroll.addView(view);scroll.setFillViewport(true);scroll.setLayoutParams(new ViewGroup.LayoutParams(-1,NativeUi.dp(this,520)));return scroll;}
    private LinearLayout simpleRow(String icon,String title,String subtitle){LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(NativeUi.dp(this,10),NativeUi.dp(this,9),NativeUi.dp(this,8),NativeUi.dp(this,9));row.setBackground(NativeUi.outlined(this,Color.WHITE,NativeUi.LINE,12));TextView badge=NativeUi.text(this,icon,18,NativeUi.GREEN,true);badge.setGravity(Gravity.CENTER);badge.setBackground(NativeUi.shape(this,NativeUi.GREEN_SOFT,10));row.addView(badge,new LinearLayout.LayoutParams(NativeUi.dp(this,40),NativeUi.dp(this,40)));LinearLayout words=new LinearLayout(this);words.setOrientation(LinearLayout.VERTICAL);TextView top=NativeUi.text(this,title,14,NativeUi.INK,true),bottom=NativeUi.text(this,subtitle,11,NativeUi.MUTED,false);words.addView(top);words.addView(bottom);row.addView(words,NativeUi.margins(this,new LinearLayout.LayoutParams(0,-2,1),10,0,8,0));return row;}
    private TextView sheetSection(String title,int count){TextView section=NativeUi.text(this,title+(count>=0?"  ·  "+count:""),13,NativeUi.INK,true);section.setGravity(Gravity.BOTTOM);return section;}

    FundsApi.Callback callbackRefresh(String message){return new FundsApi.Callback(){public void success(JSONObject response){data=response;toast(message);buildShell();deliverNotifications();}public void error(String error){toast(error);}};}

    private void deliverNotifications(){
        for(JSONObject item:NativeUi.objects(data.optJSONArray("notifications"))){if(item.optBoolean("nativeDelivered"))continue;boolean shown=false;String type=item.optString("type");if(type.equals("payment_request")){JSONObject payment=findById(data.optJSONObject("payments").optJSONArray("incoming"),item.optString("entityId"));if(payment!=null)shown=PaymentNotificationManager.showIncoming(this,payment.optString("id"),payment.optString("payeeName"),(int)Math.round(payment.optDouble("amount")),payment.optString("purpose"));}else if(type.equals("poll_open")){JSONObject[] owner=findPoll(item.optString("entityId"));if(owner!=null&&(owner[1].isNull("myVote")||owner[1].optString("myVote").isEmpty())){PollPayload payload=payload(owner[0],owner[1]);shown=PollNotificationManager.show(this,payload);}}else shown=AppNotificationManager.show(this,item.optString("id"),item.optString("title"),item.optString("body"),type,parseTime(item.optString("persistentUntil")));
            if(shown)api.post("/notifications/"+item.optString("id")+"/delivered",new JSONObject(),new FundsApi.Callback(){public void success(JSONObject ignored){}public void error(String ignored){}});
        }
    }

    private JSONObject findById(JSONArray values,String id){for(JSONObject value:NativeUi.objects(values))if(id.equals(value.optString("id")))return value;return null;}
    private JSONObject[] findPoll(String id){for(JSONObject group:NativeUi.objects(data.optJSONArray("groups")))for(JSONObject poll:NativeUi.objects(group.optJSONArray("polls")))if(id.equals(poll.optString("id")))return new JSONObject[]{group,poll};return null;}
    private PollPayload payload(JSONObject group,JSONObject poll){boolean option="options".equals(poll.optString("pollType"));int count=option?(poll.optJSONArray("voteDetails")==null?0:poll.optJSONArray("voteDetails").length()):poll.optInt("yesCount");return new PollPayload(poll.optString("id"),group.optString("name"),group.optString("emoji"),poll.optString("title"),poll.optString("bsDate"),poll.optString("bsDate"),NativeUi.eventTime(poll.optString("eventAt")),count,poll.optInt("minYes",1),120,poll.optString("pollType","yes_no"),poll.optJSONArray("options"));}
    private long parseTime(String iso){if(iso==null||iso.isEmpty())return 0;for(String format:new String[]{"yyyy-MM-dd'T'HH:mm:ss.SSSX","yyyy-MM-dd'T'HH:mm:ssX"})try{return new SimpleDateFormat(format,Locale.US).parse(iso).getTime();}catch(Exception ignored){}return 0;}

    private void consumePollActions(){JSONArray actions=PollNotificationManager.takePendingActions(this);if(actions.length()==0)return;consumeAction(actions,0);}
    private void consumeAction(JSONArray actions,int index){if(index>=actions.length()){refresh();return;}JSONObject action=actions.optJSONObject(index);if(action==null){consumeAction(actions,index+1);return;}String choice=action.optString("action");if(choice.isEmpty()){consumeAction(actions,index+1);return;}JSONObject body=new JSONObject();try{body.put("choice",choice);}catch(Exception ignored){}String pollId=action.optString("pollId");api.post("/polls/"+pollId+"/vote",body,new FundsApi.Callback(){public void success(JSONObject response){data=response;PollNotificationManager.cancel(MainActivity.this,pollId);consumeAction(actions,index+1);}public void error(String message){toast(message);consumeAction(actions,index+1);}});}
}
